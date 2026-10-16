'use strict';
// proto3 -> IDL 导入器（ROADMAP 阶段五）
// 用法（浏览器）：window.parseProtoText(text) -> { project, warnings }
// 用法（node 测试）：const { parseProtoText, protoToModel } = require('./protoImporter.js')
// 说明：把外部 protobuf / gRPC（proto3）契约反解回内部 IDL 模型，用于"导入续写"。
//   与 toProto() 生成器严格对称：子集内可往返还原；有损项以 warnings 返回。
//   零新增依赖（纯浏览器 JS，无第三方解析库）。

(function () {
  const pascal = (s) => String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  const lastSeg = (s) => String(s || '').split('.').pop();
  const uid = () => Math.random().toString(36).slice(2, 9);

  // proto 标量 -> IDL 类型（与 toProto.protoElem 反向）
  const SCALAR = {
    string: 'string', bytes: 'bytes',
    int32: 'int', int64: 'int', uint32: 'int', uint64: 'int',
    sint32: 'int', sint64: 'int', fixed32: 'int', fixed64: 'int',
    sfixed32: 'int', sfixed64: 'int',
    float: 'number', double: 'number', bool: 'bool',
  };

  function newField(o) {
    return Object.assign({ id: uid(), name: '', type: 'string', required: false, in: 'body', desc: '', enum: [], itemsType: 'string', itemsRef: '', ref: '', mapValueType: 'string', mapValueRef: '', tag: 0, oneof: '', options: {} }, o || {});
  }
  function newModel(o) {
    return Object.assign({ id: uid(), name: '', desc: '', fields: [], reserved: { numbers: [], names: [] }, options: {} }, o || {});
  }
  function newProject(o) {
    return Object.assign({ name: 'MyService', version: '1.0.0', description: '', imports: [], options: {}, resources: [], models: [] }, o || {});
  }

  // ---------------- Lexer ----------------
  function tokenize(src) {
    const toks = []; const n = src.length; let i = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\n' || c === '\r' || c === ' ' || c === '\t' || c === '\u00a0') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') {
        let j = src.indexOf('\n', i); if (j < 0) j = n;
        toks.push({ type: 'comment', text: src.slice(i + 2, j).trim() }); i = j; continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2;
        toks.push({ type: 'comment', text: src.slice(i + 2, e < 0 ? n : e).trim() }); i = end; continue;
      }
      if (c === '"' || c === "'") {
        const q = c; let j = i + 1; let s = '';
        while (j < n && src[j] !== q) { if (src[j] === '\\' && j + 1 < n) { s += src[j] + src[j + 1]; j += 2; } else { s += src[j]; j++; } }
        toks.push({ type: 'string', value: s.replace(/\\"/g, '"').replace(/\\\\/g, '\\') }); i = j < n ? j + 1 : n; continue;
      }
      if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i + 1; while (j < n && /[0-9a-zA-Z_\.+-]/.test(src[j])) j++;
        toks.push({ type: 'number', value: src.slice(i, j) }); i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ type: 'ident', value: src.slice(i, j) }); i = j; continue;
      }
      if ('{}()[]=;,.<>-'.indexOf(c) >= 0) { toks.push({ type: 'punct', value: c }); i++; continue; }
      i++;
    }
    return toks;
  }

  // ---------------- Parser ----------------
  function cur(ctx) { return ctx.R ? ctx.R[ctx.pos] : undefined; }
  function look(ctx, k) { return ctx.R ? ctx.R[ctx.pos + k] : undefined; }
  function eat(ctx) { const r = ctx.R[ctx.pos]; ctx.pos++; return r; }
  // 每个非注释 token 的「紧邻前导注释」（连续注释合并），用于声明描述提取
  function lead(ctx) { return (ctx.lead && ctx.lead[ctx.pos]) || ''; }

  function expect(ctx, type, val) {
    const t = eat(ctx);
    if (!t || t.type !== type || (val !== undefined && t.value !== val)) throw new Error('语法错误：期望 ' + (val || type) + '，得到 ' + (t ? t.value : '文件结尾'));
    return t;
  }
  function expectPunct(ctx, val) { expect(ctx, 'punct', val); }
  function expectIdent(ctx) { return expect(ctx, 'ident').value; }
  function isIdent(ctx, v) { const t = cur(ctx); return !!(t && t.type === 'ident' && t.value === v); }

  function parseFullIdent(ctx) {
    let s = expectIdent(ctx);
    while (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '.' && look(ctx, 1) && look(ctx, 1).type === 'ident') { eat(ctx); s += '.' + expectIdent(ctx); }
    return s;
  }
  function parseType(ctx) {
    let s = '';
    if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '.') { eat(ctx); s = '.'; }
    s += expectIdent(ctx);
    while (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '.' && look(ctx, 1) && look(ctx, 1).type === 'ident') { eat(ctx); s += '.' + expectIdent(ctx); }
    return s;
  }
  function parseOptionName(ctx) {
    let s = '';
    if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '(') { eat(ctx); s = '(' + parseFullIdent(ctx) + ')'; expectPunct(ctx, ')'); }
    else s = parseFullIdent(ctx);
    while (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '.' && look(ctx, 1) && look(ctx, 1).type === 'ident') { eat(ctx); s += '.' + expectIdent(ctx); }
    return s;
  }
  function parseConstant(ctx) {
    const t = cur(ctx);
    if (!t) throw new Error('option 常量缺失');
    if (t.type === 'number') { eat(ctx); return t.value; }
    if (t.type === 'string') { eat(ctx); return t.value; }
    if (t.type === 'ident') { eat(ctx); return t.value; }
    if (t.type === 'punct' && t.value === '-') { eat(ctx); const x = expect(ctx, 'number'); return '-' + x.value; }
    if (t.type === 'punct' && t.value === '{') {
      eat(ctx); let depth = 1; const parts = [];
      while (true) {
        const x = cur(ctx); if (!x) throw new Error('option aggregate 未闭合');
        if (x.type === 'punct' && x.value === '{') depth++;
        if (x.type === 'punct' && x.value === '}') { depth--; if (depth === 0) { eat(ctx); break; } }
        eat(ctx); parts.push(x.value);
      }
      return '{' + parts.join(' ') + '}';
    }
    throw new Error('option 常量不支持：' + t.value);
  }
  function skipToPunct(ctx, v) {
    while (cur(ctx) && !(cur(ctx).type === 'punct' && cur(ctx).value === v)) eat(ctx);
  }

  // 字段选项 [ (a)=v, b=v ]
  function parseFieldOptions(ctx, f, warnings) {
    if (!(cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '[')) return;
    eat(ctx);
    while (cur(ctx)) {
      const t = cur(ctx);
      if (t.type === 'punct' && t.value === ']') { eat(ctx); break; }
      if (t.type === 'punct' && (t.value === ',' || t.value === ';')) { eat(ctx); continue; }
      if (t.type === 'ident' && t.value === 'default') { eat(ctx); expectPunct(ctx, '='); parseConstant(ctx); warnings.push('字段 default 选项忽略（proto2 语义）'); continue; }
      const nm = parseOptionName(ctx); expectPunct(ctx, '='); const v = parseConstant(ctx); f.options[nm] = v;
    }
  }
  function parseReserved(ctx, res, warnings) {
    while (cur(ctx)) {
      const t = cur(ctx);
      if (t.type === 'number') {
        res.numbers.push(parseInt(t.value, 10)); eat(ctx);
        if (isIdent(ctx, 'to')) { eat(ctx); const e = cur(ctx); if (e && e.type === 'number') { res.numbers.push(parseInt(e.value, 10)); warnings.push('reserved 区间已折为端点记录'); eat(ctx); } }
      } else if (t.type === 'string') { res.names.push(expect(ctx, 'string').value); }
      else break;
      if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === ',') eat(ctx); else break;
    }
  }

  function parseField(ctx, msg, warnings) {
    const leading = lead(ctx);
    let repeated = false;
    let t = cur(ctx);
    if (t && t.type === 'ident' && (t.value === 'repeated' || t.value === 'optional' || t.value === 'required')) {
      if (t.value === 'required') warnings.push('required（proto2 语义）忽略必填');
      if (t.value === 'repeated') repeated = true;
      eat(ctx);
    }
    const fr = { name: '', desc: leading, tag: 0, oneof: '', options: {}, kind: 'self', ty: '' };
    // map<K,V>
    if (t0is(ctx, 'map') && look(ctx, 1) && look(ctx, 1).type === 'punct' && look(ctx, 1).value === '<') {
      eat(ctx); expectPunct(ctx, '<'); const kt = parseType(ctx); expectPunct(ctx, ','); const vt = parseType(ctx); expectPunct(ctx, '>');
      fr.name = expectIdent(ctx); fr.kind = 'map'; fr.ty = vt;
      if (kt !== 'string') warnings.push('map key 非 string（' + kt + '），map 保留但 OpenAPI 侧 key 视为 string');
      expectPunct(ctx, '='); fr.tag = parseInt(expect(ctx, 'number').value, 10); parseFieldOptions(ctx, fr, warnings); expectPunct(ctx, ';');
      msg.fields.push(fr); return;
    }
    const ty = parseType(ctx);
    fr.name = expectIdent(ctx);
    if (repeated) { fr.kind = 'array'; fr.ty = ty; } else { fr.kind = 'self'; fr.ty = ty; }
    expectPunct(ctx, '='); fr.tag = parseInt(expect(ctx, 'number').value, 10); parseFieldOptions(ctx, fr, warnings); expectPunct(ctx, ';');
    msg.fields.push(fr);
  }
  function t0is(ctx, v) { const t = cur(ctx); return !!(t && t.type === 'ident' && t.value === v); }

  function parseOneof(ctx, msg, warnings) {
    eat(ctx); const oname = expectIdent(ctx); expectPunct(ctx, '{');
    while (true) {
      const t = cur(ctx); if (!t) throw new Error('oneof 未闭合');
      if (t.type === 'punct' && t.value === '}') { eat(ctx); break; }
      if (t.type === 'punct' && t.value === ';') { eat(ctx); continue; }
      if (t.type === 'ident' && t.value === 'option') { eat(ctx); const nm = parseOptionName(ctx); expectPunct(ctx, '='); parseConstant(ctx); expectPunct(ctx, ';'); continue; }
      const leading = lead(ctx);
      const ty = parseType(ctx); const fname = expectIdent(ctx);
      const fr = { name: fname, desc: leading, tag: 0, oneof: oname, options: {}, kind: 'self', ty };
      expectPunct(ctx, '='); fr.tag = parseInt(expect(ctx, 'number').value, 10); parseFieldOptions(ctx, fr, warnings); expectPunct(ctx, ';');
      msg.fields.push(fr);
    }
  }

  function parseEnum(ctx, warnings) {
    const leading = lead(ctx);
    eat(ctx); const name = expectIdent(ctx); expectPunct(ctx, '{');
    const values = [];
    while (true) {
      const t = cur(ctx); if (!t) throw new Error('enum 未闭合');
      if (t.type === 'punct' && t.value === '}') { eat(ctx); break; }
      if (t.type === 'punct' && t.value === ';') { eat(ctx); continue; }
      if (t.type === 'ident' && t.value === 'option') { eat(ctx); parseOptionName(ctx); expectPunct(ctx, '='); parseConstant(ctx); expectPunct(ctx, ';'); continue; }
      if (t.type === 'ident' && t.value === 'reserved') { eat(ctx); skipToPunct(ctx, ';'); expectPunct(ctx, ';'); continue; }
      const cn = expectIdent(ctx); expectPunct(ctx, '='); const num = expect(ctx, 'number');
      if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '[') { skipToPunct(ctx, ']'); eat(ctx); }
      expectPunct(ctx, ';');
      values.push({ name: cn, num: parseInt(num.value, 10) });
    }
    // 剔除生成器自动注入的 <Enum>_UNSPECIFIED=0 哨兵，还原原始值列表
    let names = values.map((v) => v.name);
    if (names.length && /_UNSPECIFIED$/.test(names[0])) names = names.slice(1);
    return { name, values: names, leading };
  }

  function parseMessage(ctx, warnings) {
    const leading = lead(ctx);
    eat(ctx); const name = expectIdent(ctx); expectPunct(ctx, '{');
    const m = { name, desc: leading, fields: [], reserved: { numbers: [], names: [] }, options: {}, nestedMessages: [], nestedEnums: {} };
    while (true) {
      const t = cur(ctx); if (!t) throw new Error('message ' + name + ' 未闭合');
      if (t.type === 'punct' && t.value === '}') { eat(ctx); break; }
      if (t.type === 'punct' && t.value === ';') { eat(ctx); continue; }
      if (t.type === 'ident' && t.value === 'reserved') { eat(ctx); parseReserved(ctx, m.reserved, warnings); expectPunct(ctx, ';'); continue; }
      if (t.type === 'ident' && t.value === 'option') { eat(ctx); const nm = parseOptionName(ctx); expectPunct(ctx, '='); m.options[nm] = parseConstant(ctx); expectPunct(ctx, ';'); continue; }
      if (t.type === 'ident' && t.value === 'message') { m.nestedMessages.push(parseMessage(ctx, warnings)); continue; }
      if (t.type === 'ident' && t.value === 'enum') { const e = parseEnum(ctx, warnings); m.nestedEnums[e.name] = e.values; continue; }
      if (t.type === 'ident' && t.value === 'oneof') { parseOneof(ctx, m, warnings); continue; }
      if (t.type === 'ident' && t.value === 'extensions') { eat(ctx); skipToPunct(ctx, ';'); expectPunct(ctx, ';'); warnings.push('extensions 不支持，已跳过'); continue; }
      parseField(ctx, m, warnings);
    }
    return m;
  }

  function splitComment(leading) {
    const lines = String(leading || '').split('\n').map((l) => l.trim());
    const desc = [], note = []; let inNote = false;
    for (const l of lines) {
      if (l.startsWith('备注：')) { inNote = true; note.push(l.slice(3).trim()); continue; }
      if (inNote) { note.push(l); continue; }
      desc.push(l);
    }
    return { desc: desc.filter(Boolean).join('\n'), note: note.filter(Boolean).join('\n') };
  }

  function parseRpc(ctx, warnings) {
    const leading = lead(ctx);
    eat(ctx); const mname = expectIdent(ctx);
    expectPunct(ctx, '(');
    let streamIn = false; if (isIdent(ctx, 'stream')) { streamIn = true; eat(ctx); }
    const reqType = parseType(ctx);
    expectPunct(ctx, ')');
    expectIdent(ctx, 'returns');
    expectPunct(ctx, '(');
    let streamOut = false; if (isIdent(ctx, 'stream')) { streamOut = true; eat(ctx); }
    const respType = parseType(ctx);
    expectPunct(ctx, ')');
    const options = {};
    if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === ';') { eat(ctx); }
    else if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '{') {
      eat(ctx);
      while (true) {
        const t = cur(ctx); if (!t) throw new Error('rpc 块未闭合');
        if (t.type === 'punct' && t.value === '}') { eat(ctx); break; }
        if (t.type === 'punct' && t.value === ';') { eat(ctx); continue; }
        if (t.type === 'ident' && t.value === 'option') { eat(ctx); const nm = parseOptionName(ctx); expectPunct(ctx, '='); options[nm] = parseConstant(ctx); expectPunct(ctx, ';'); continue; }
        eat(ctx);
      }
    } else { throw new Error('rpc 结尾缺少 ; 或 { }'); }
    const c = splitComment(leading);
    let stream = 'none';
    if (streamIn && streamOut) stream = 'bidi'; else if (streamIn) stream = 'client'; else if (streamOut) stream = 'server';
    return { name: mname, desc: c.desc, note: c.note, stream, reqType, respType, options };
  }

  function parseService(ctx, warnings) {
    const leading = lead(ctx);
    eat(ctx); const name = expectIdent(ctx); expectPunct(ctx, '{');
    const methods = [];
    while (true) {
      const t = cur(ctx); if (!t) throw new Error('service ' + name + ' 未闭合');
      if (t.type === 'punct' && t.value === '}') { eat(ctx); break; }
      if (t.type === 'punct' && t.value === ';') { eat(ctx); continue; }
      if (t.type === 'ident' && t.value === 'option') { eat(ctx); parseOptionName(ctx); expectPunct(ctx, '='); parseConstant(ctx); expectPunct(ctx, ';'); continue; }
      if (t.type === 'ident' && t.value === 'rpc') { methods.push(parseRpc(ctx, warnings)); continue; }
      eat(ctx); warnings.push('service 内未识别声明已跳过');
    }
    return { name, desc: leading, methods };
  }

  function parseProtoText(src) {
    const warnings = [];
    const toks = tokenize(String(src || ''));
    // 分离注释：为每个非注释 token 预计算其紧邻前导注释
    const R = []; const leadArr = []; let pending = '';
    for (const t of toks) {
      if (t.type === 'comment') { pending = pending ? pending + '\n' + t.text : t.text; continue; }
      R.push(t); leadArr.push(pending); pending = '';
    }
    const ctx = { R, lead: leadArr, pos: 0, warnings };
    const P = newProject();
    P._package = '';
    while (cur(ctx)) {
      const t = cur(ctx);
      if (t.type === 'punct' && t.value === ';') { eat(ctx); continue; }
      if (t.type === 'ident' && t.value === 'syntax') { eat(ctx); expectPunct(ctx, '='); const s = expect(ctx, 'string'); expectPunct(ctx, ';'); if (s.value !== 'proto3') warnings.push('非 proto3 语法（' + s.value + '），部分映射可能不适用'); continue; }
      if (t.type === 'ident' && t.value === 'package') { eat(ctx); P._package = parseFullIdent(ctx); expectPunct(ctx, ';'); continue; }
      if (t.type === 'ident' && t.value === 'import') {
        eat(ctx);
        if (cur(ctx) && cur(ctx).type === 'ident' && (cur(ctx).value === 'public' || cur(ctx).value === 'weak')) { eat(ctx); warnings.push('import ' + (cur(ctx) && cur(ctx).value) + ' 修饰忽略'); }
        const s = expect(ctx, 'string'); expectPunct(ctx, ';');
        if (!String(s.value).startsWith('google/protobuf/')) P.imports.push(s.value);
        continue;
      }
      if (t.type === 'ident' && t.value === 'option') { eat(ctx); const nm = parseOptionName(ctx); expectPunct(ctx, '='); P.options[nm] = parseConstant(ctx); expectPunct(ctx, ';'); continue; }
      if (t.type === 'ident' && t.value === 'message') { P._messages = P._messages || []; P._messages.push(parseMessage(ctx, warnings)); continue; }
      if (t.type === 'ident' && t.value === 'enum') { P._enums = P._enums || {}; const e = parseEnum(ctx, warnings); P._enums[e.name] = e.values; continue; }
      if (t.type === 'ident' && t.value === 'service') { P._services = P._services || []; P._services.push(parseService(ctx, warnings)); continue; }
      if (t.type === 'ident' && (t.value === 'extend' || t.value === 'edition')) { eat(ctx); warnings.push('不支持 ' + t.value + '，已跳过该声明'); skipToPunct(ctx, '}'); if (cur(ctx) && cur(ctx).type === 'punct' && cur(ctx).value === '}') eat(ctx); continue; }
      eat(ctx); warnings.push('未识别语法「' + t.value + '」，已跳过');
    }
    const project = protoToModel(P, warnings);
    return { project, warnings };
  }

  // ---------------- 反向映射 ----------------
  function applyType(ctx, ty, f, kind, warnings) {
    const st = String(ty || '').replace(/^\./, '');
    const assign = (t) => { if (kind === 'self') f.type = t; else if (kind === 'items') f.itemsType = t; else f.mapValueType = t; };
    if (st === 'google.protobuf.Timestamp') { assign('timestamp'); return; }
    if (st === 'google.protobuf.Empty') { warnings.push('google.protobuf.Empty 出现在字段位置，按 string 处理'); assign('string'); return; }
    if (SCALAR.hasOwnProperty(st)) {
      if (st === 'bytes') { warnings.push('bytes 不在类型子集，按 string 占位'); assign('string'); return; }
      if (['int32', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64'].includes(st)) warnings.push('整数类型 ' + st + ' 归一到 int(int64)');
      if (st === 'float') warnings.push('float 归一到 number(double)');
      assign(SCALAR[st]); return;
    }
    const ls = lastSeg(st);
    if (ctx.enums && ctx.enums.hasOwnProperty(ls)) {
      if (kind === 'self') { f.type = 'enum'; f.enum = (ctx.enums[ls] || []).slice(); ctx.usedEnums[ls] = true; }
      else { warnings.push('「' + st + '」为枚举，用于 ' + (kind === 'items' ? '数组元素' : 'map 值') + '，子集不支持，按 string 占位'); assign('string'); }
      return;
    }
    const target = (ctx.alias && ctx.alias[ls]) || ls;
    if (kind === 'self') { f.type = 'ref'; f.ref = target; }
    else if (kind === 'items') { f.itemsType = 'ref'; f.itemsRef = target; }
    else { f.mapValueType = 'ref'; f.mapValueRef = target; }
  }

  function mapField(ctx, fr, warnings) {
    const f = newField({ name: fr.name });
    f.desc = fr.desc || ''; f.in = 'body'; f.tag = fr.tag || 0;
    if (fr.oneof) f.oneof = fr.oneof;
    if (fr.options && Object.keys(fr.options).length) f.options = fr.options;
    if (fr.kind === 'array') { f.type = 'array'; applyType(ctx, fr.ty, f, 'items', warnings); }
    else if (fr.kind === 'map') { f.type = 'map'; applyType(ctx, fr.ty, f, 'map', warnings); }
    else applyType(ctx, fr.ty, f, 'self', warnings);
    return f;
  }

  function protoToModel(P, warnings) {
    // 1) 枚举注册表（顶层 + 嵌套，按末段名归并）
    const enumMap = {}; const usedEnums = {};
    const registerEnum = (n, vals) => { const ls = lastSeg(n); if (!(ls in enumMap)) enumMap[ls] = (vals || []).slice(); };
    for (const [n, vals] of Object.entries(P._enums || {})) registerEnum(n, vals);
    for (const m of (P._messages || [])) for (const [n, vals] of Object.entries(m.nestedEnums || {})) registerEnum(n, vals);
    const ctx = { enums: enumMap, usedEnums, alias: {} };

    // 2) 扁平化 message（嵌套提升为 Parent_Child）
    const list = []; const names = new Set(); const alias = ctx.alias;
    (function flatten(msgs, parentFinal, parentFull) {
      for (const m of msgs || []) {
        const full = parentFull ? parentFull + '.' + m.name : m.name;
        let final = parentFinal ? parentFinal + '_' + m.name : m.name;
        if (names.has(final)) { let k = 2; while (names.has(final + '_' + k)) k++; warnings.push('模型名冲突「' + final + '」已避让为 ' + final + '_' + k); final = final + '_' + k; }
        names.add(final);
        m._final = final; m._full = full;
        list.push(m);
        alias[lastSeg(full)] = final; alias[full] = final; alias[lastSeg(final)] = final;
        flatten(m.nestedMessages, final, full);
      }
    })(P._messages, '', '');
    if ((P._messages || []).some((m) => m.nestedMessages && m.nestedMessages.length)) warnings.push('message 内嵌套 message 已提升为顶层模型（Parent_Child 命名）');

    // 3) 字段级引用计数（决定哪些消息可安全内联）
    const refCount = {};
    const bumpRef = (name) => { refCount[name] = (refCount[name] || 0) + 1; };
    const tyKind = (ty) => { const st = String(ty || '').replace(/^\./, ''); if (st === 'google.protobuf.Timestamp' || SCALAR.hasOwnProperty(st) || (ctx.enums && ctx.enums.hasOwnProperty(lastSeg(st)))) return 'scalar'; return 'msg'; };
    for (const m of list) for (const fr of m.fields) {
      if (fr.kind === 'items') { if (tyKind(fr.ty) === 'msg') bumpRef((ctx.alias[lastSeg(fr.ty)] || lastSeg(fr.ty))); }
      else if (fr.kind === 'map') { if (tyKind(fr.ty) === 'msg') bumpRef((ctx.alias[lastSeg(fr.ty)] || lastSeg(fr.ty))); }
      else if (tyKind(fr.ty) === 'msg') bumpRef((ctx.alias[lastSeg(fr.ty)] || lastSeg(fr.ty)));
    }

    // 4) rpc request/response 引用
    const reqUse = {}, respUse = {};
    const reqMsgOf = (ty) => { const st = String(ty || '').replace(/^\./, ''); return st === 'google.protobuf.Empty' ? null : (ctx.alias[lastSeg(st)] || lastSeg(st)); };
    for (const svc of (P._services || [])) for (const rpc of svc.methods) {
      const rq = reqMsgOf(rpc.reqType); if (rq) { reqUse[rq] = (reqUse[rq] || 0) + 1; }
      const rs = reqMsgOf(rpc.respType); if (rs) { respUse[rs] = (respUse[rs] || 0) + 1; }
    }

    // 5) 构建 resources / methods
    const resources = [];
    for (const svc of (P._services || [])) {
      const resName = pascal(String(svc.name).replace(/Service$/, '')) || 'Service';
      const res = { id: uid(), name: resName, desc: svc.desc || '', methods: [] };
      const consumed = {};
      for (const rpc of svc.methods) {
        const m = { id: uid(), name: rpc.name, http: '', desc: rpc.desc || '', note: rpc.note || '', example: '', input: [], output: { kind: 'void', ref: '', fields: [] }, errors: [], stream: rpc.stream || 'none', options: {} };
        if (rpc.options && Object.keys(rpc.options).length) m.options = rpc.options;
        const rq = reqMsgOf(rpc.reqType);
        if (rq) {
          const msg = list.find((x) => x._final === rq);
          // proto 为真源：具名请求消息一律保留为模型，方法以 body:ref 引用（不内联、不合成包装）
          if (msg) { m.input = [newField({ name: 'body', type: 'ref', ref: rq })]; }
        }
        const rs = reqMsgOf(rpc.respType);
        if (rs) {
          const msg = list.find((x) => x._final === rs);
          // 同理：具名响应消息保留为模型，方法以 output:ref 引用
          if (msg) { m.output = { kind: 'ref', ref: rs, fields: [] }; }
        }
        res.methods.push(m);
      }
      res._consumed = consumed;
      resources.push(res);
    }

    // 6) models = 未被消费的消息
    const consumedAll = {};
    for (const r of resources) for (const k of Object.keys(r._consumed || {})) consumedAll[k] = true;
    const models = [];
    for (const m of list) {
      if (consumedAll[m._final]) continue;
      const md = newModel({ name: m._final, desc: m.desc || '' });
      if (m.options && Object.keys(m.options).length) md.options = m.options;
      if (m.reserved && (m.reserved.numbers.length || m.reserved.names.length)) md.reserved = { numbers: m.reserved.numbers.slice(), names: m.reserved.names.slice() };
      for (const fr of m.fields) md.fields.push(mapField(ctx, fr, warnings));
      models.push(md);
    }

    // 7) 未使用枚举告警
    for (const n of Object.keys(enumMap)) if (!usedEnums[n]) warnings.push('枚举「' + n + '」未被任何字段引用，已丢弃');

    // 项目装配：name 取 proto package（保证再生成时 package 往返一致）
    const pkg = (P._package || '').trim();
    const project = newProject();
    project.name = pkg ? pkg : 'MyService';
    if (pkg) project.options['_proto_package'] = pkg;
    project.imports = P.imports || [];
    project.resources = resources;
    project.models = models;
    if (P.options && Object.keys(P.options).length) { for (const k of Object.keys(P.options)) project.options[k] = P.options[k]; }
    return project;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { protoToModel, parseProtoText };
  if (typeof window !== 'undefined') { window.protoToModel = protoToModel; window.parseProtoText = parseProtoText; }
})();
