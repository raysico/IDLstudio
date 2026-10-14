'use strict';
// API 设计台 —— 前端逻辑（原生 JS）
// 内部 IDL 模型 -> 表单 / 源码双向同步 -> 生成 OpenAPI 3.1 与 protobuf/gRPC -> mock 调试台

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function snake(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase(); }
function pascal(s) { return String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(''); }
function pluralize(s) {
  if (/[sxz]$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  return s + 's';
}
const SCALAR_TYPES = ['string', 'int', 'number', 'bool', 'timestamp'];
const ALL_TYPES = ['string', 'int', 'number', 'bool', 'timestamp', 'enum', 'array', 'ref', 'map'];
const LOCATIONS = ['body', 'path', 'query', 'header'];
const STD_METHODS = ['Get', 'List', 'Create', 'Update', 'Delete'];

let project = null;
let sel = { kind: null, id: null };
let activeTab = 'source';
let dark = false;

// ---------- 内部模型 ----------
function newField(o) {
  return Object.assign({ id: uid(), name: '', type: 'string', required: false, in: 'body', desc: '', enum: [], itemsType: 'string', itemsRef: '', ref: '', mapValueType: 'string', mapValueRef: '', tag: 0, oneof: '', options: {} }, o || {});
}
function newMethod(o) {
  return Object.assign({ id: uid(), name: '', http: '', desc: '', note: '', example: '', input: [], output: { kind: 'void', ref: '', fields: [] }, errors: [], stream: 'none', options: {} }, o || {});
}
function newResource(o) {
  return Object.assign({ id: uid(), name: '', desc: '', methods: [] }, o || {});
}
function newModel(o) {
  return Object.assign({ id: uid(), name: '', desc: '', fields: [], reserved: { numbers: [], names: [] }, options: {} }, o || {});
}

function defaultProject() {
  const node = newModel({ name: 'Node', desc: '节点', fields: [
    newField({ name: 'id', type: 'string', desc: '节点 id' }),
    newField({ name: 'name', type: 'string', desc: '名称', required: true }),
    newField({ name: 'status', type: 'enum', enum: ['draft', 'published'], desc: '状态' }),
    newField({ name: 'createdAt', type: 'timestamp', desc: '创建时间' }),
  ]});
  const create = newMethod({ name: 'Create', http: 'POST /nodes', desc: '创建节点', input: [
    newField({ name: 'name', type: 'string', required: true, desc: '名称' }),
    newField({ name: 'parentId', type: 'ref', ref: 'Node', desc: '父节点' }),
    newField({ name: 'tags', type: 'array', itemsType: 'string', desc: '标签' }),
  ], output: { kind: 'ref', ref: 'Node', fields: [] }, errors: [400, 409] });
  const get = newMethod({ name: 'Get', http: '', desc: '读取节点', input: [
    newField({ name: 'id', type: 'string', in: 'path', required: true, desc: '节点 id' }),
  ], output: { kind: 'ref', ref: 'Node', fields: [] }, errors: [404] });
  const list = newMethod({ name: 'List', http: '', desc: '列出节点', input: [
    newField({ name: 'pageSize', type: 'int', in: 'query', desc: '每页数量' }),
    newField({ name: 'pageToken', type: 'string', in: 'query', desc: '分页游标' }),
  ], output: { kind: 'inline', ref: '', fields: [
    newField({ name: 'nodes', type: 'array', itemsType: 'ref', itemsRef: 'Node', desc: '节点列表' }),
    newField({ name: 'nextPageToken', type: 'string', desc: '下一页游标' }),
  ] }, errors: [] });
  const update = newMethod({ name: 'Update', http: '', desc: '更新节点', input: [
    newField({ name: 'id', type: 'string', in: 'path', required: true, desc: '节点 id' }),
    newField({ name: 'name', type: 'string', desc: '新名称' }),
  ], output: { kind: 'ref', ref: 'Node', fields: [] }, errors: [404, 409] });
  const del = newMethod({ name: 'Delete', http: '', desc: '删除节点', input: [
    newField({ name: 'id', type: 'string', in: 'path', required: true, desc: '节点 id' }),
  ], output: { kind: 'void', ref: '', fields: [] }, errors: [404] });

  return {
    name: 'MyService', version: '1.0.0', description: '', imports: [], options: {},
    resources: [newResource({ name: 'Node', desc: '节点资源', methods: [create, get, list, update, del] })],
    models: [node],
  };
}

function findRes(rId) { return project.resources.find((r) => r.id === rId); }
function findMethod(mId) { for (const r of project.resources) { const m = r.methods.find((x) => x.id === mId); if (m) return { r, m }; } return null; }
function findModel(mId) { return project.models.find((m) => m.id === mId); }

// ---------- YAML 源码：序列化 / 解析 ----------
// ---------- options 兜底袋 ----------
function optNonEmpty(o) { return o && typeof o === 'object' && Object.keys(o).length ? o : null; }
function parseOptions(text) {
  try { const v = window.jsyaml.load(text || '{}'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; } catch (e) { return {}; }
}
function optsToText(o) {
  const k = optNonEmpty(o); return k ? window.jsyaml.dump(k) : '';
}
function optVal(v) { return typeof v === 'string' ? '"' + v.replace(/"/g, '\\"') + '"' : String(v); }
function protoOptionsInline(o) { return Object.keys(o || {}).map((k) => k + ' = ' + optVal(o[k])).join(', '); }

function fieldToYaml(f) {
  const o = {};
  if (f.type !== 'string') o.type = f.type;
  if (f.in !== 'body') o.in = f.in;
  if (f.required) o.required = true;
  if (f.desc) o.desc = f.desc;
  if (f.tag > 0) o.tag = f.tag;
  if (f.oneof) o.oneof = f.oneof;
  if (optNonEmpty(f.options)) o.options = f.options;
  if (f.type === 'enum' && f.enum && f.enum.length) o.enum = f.enum;
  if (f.type === 'array') {
    o.items = f.itemsType === 'ref' ? { type: 'ref', ref: f.itemsRef } : f.itemsType;
  }
  if (f.type === 'ref' && f.ref) o.ref = f.ref;
  if (f.type === 'map') o.value = f.mapValueType === 'ref' ? { type: 'ref', ref: f.mapValueRef } : f.mapValueType;
  return o;
}
function fieldsToYamlMap(fields) {
  const o = {};
  for (const f of fields) if (f.name) o[f.name] = fieldToYaml(f);
  return o;
}
function outputToYaml(out) {
  if (out.kind === 'ref' && out.ref) return out.ref;
  if (out.kind === 'inline') return fieldsToYamlMap(out.fields);
  return undefined;
}
function toYamlSource() {
  const root = {};
  root.name = project.name || 'MyService';
  root.version = project.version || '1.0.0';
  if (project.description) root.description = project.description;
  if (project.imports && project.imports.length) root.imports = project.imports;
  if (optNonEmpty(project.options)) root.options = project.options;
  const res = {};
  for (const r of project.resources) {
    const ro = { description: r.desc || undefined };
    const methods = {};
    for (const m of r.methods) {
      const mo = {};
      if (m.http) mo.http = m.http;
      if (m.desc) mo.description = m.desc;
      if (m.note) mo.note = m.note;
      if (m.example) mo.example = m.example;
      if (m.stream && m.stream !== 'none') mo.stream = m.stream;
      if (optNonEmpty(m.options)) mo.options = m.options;
      const inp = fieldsToYamlMap(m.input);
      if (Object.keys(inp).length) mo.input = inp;
      const out = outputToYaml(m.output);
      if (out !== undefined) mo.output = out;
      if (m.errors && m.errors.length) mo.errors = m.errors;
      if (m.name) methods[m.name] = mo;
    }
    ro.methods = methods;
    if (r.name) res[r.name] = ro;
  }
  root.resources = res;
  const models = {};
  for (const m of project.models) {
    const mo = fieldsToYamlMap(m.fields);
    if (m.reserved && ((m.reserved.numbers && m.reserved.numbers.length) || (m.reserved.names && m.reserved.names.length))) {
      mo['_reserved'] = { numbers: (m.reserved.numbers || []), names: (m.reserved.names || []) };
    }
    if (optNonEmpty(m.options)) mo.options = m.options;
    models[m.name] = mo;
  }
  root.models = models;
  return root;
}

function yamlToField(name, raw) {
  const f = newField({ name });
  if (typeof raw === 'string') { f.type = raw; return f; }
  if (!raw || typeof raw !== 'object') return f;
  if (raw.type) f.type = raw.type;
  if (raw.in) f.in = raw.in;
  if (raw.required) f.required = true;
  if (raw.desc) f.desc = String(raw.desc);
  if (raw.tag) f.tag = Number(raw.tag) || 0;
  if (raw.oneof) f.oneof = String(raw.oneof);
  if (raw.options && typeof raw.options === 'object') f.options = raw.options;
  if (Array.isArray(raw.enum)) f.enum = raw.enum.map(String);
  if (f.type === 'array') {
    if (typeof raw.items === 'string') { f.itemsType = raw.items; f.itemsRef = ''; }
    else if (raw.items && typeof raw.items === 'object') { f.itemsType = raw.items.type || 'string'; f.itemsRef = raw.items.ref || ''; }
  }
  if (f.type === 'ref' && raw.ref) f.ref = String(raw.ref);
  if (f.type === 'map') {
    if (typeof raw.value === 'string') { f.mapValueType = raw.value; f.mapValueRef = ''; }
    else if (raw.value && typeof raw.value === 'object') { f.mapValueType = raw.value.type || 'string'; f.mapValueRef = raw.value.ref || ''; }
  }
  return f;
}
function parseYamlToProject(root) {
  const p = { name: String(root.name || 'MyService'), version: String(root.version || '1.0.0'), description: String(root.description || ''), imports: Array.isArray(root.imports) ? root.imports.map(String) : [], options: (root.options && typeof root.options === 'object') ? root.options : {}, resources: [], models: [] };
  const res = root.resources || {};
  for (const [rname, ro] of Object.entries(res)) {
    if (!rname) continue;
    const r = newResource({ name: rname, desc: (ro && ro.description) || '' });
    const methods = (ro && ro.methods) || {};
    for (const [mname, mo] of Object.entries(methods)) {
      const m = newMethod({ name: mname, http: (mo && mo.http) || '', desc: (mo && mo.description) || '', note: (mo && mo.note != null) ? String(mo.note) : '', example: (mo && mo.example != null) ? String(mo.example) : '', stream: (mo && mo.stream) || 'none', options: (mo && mo.options && typeof mo.options === 'object') ? mo.options : {} });
      const inp = (mo && mo.input) || {};
      for (const [fname, fraw] of Object.entries(inp)) m.input.push(yamlToField(fname, fraw));
      const out = (mo && mo.output);
      if (typeof out === 'string') m.output = { kind: 'ref', ref: out, fields: [] };
      else if (out && typeof out === 'object') {
        const fields = [];
        for (const [fname, fraw] of Object.entries(out)) fields.push(yamlToField(fname, fraw));
        m.output = { kind: 'inline', ref: '', fields };
      } else m.output = { kind: 'void', ref: '', fields: [] };
      if (Array.isArray(mo && mo.errors)) m.errors = mo.errors.map(Number).filter((n) => !isNaN(n));
      r.methods.push(m);
    }
    p.resources.push(r);
  }
  const models = root.models || {};
  for (const [mname, mo] of Object.entries(models)) {
    if (!mname) continue;
    const mm = newModel({ name: mname });
    for (const [fname, fraw] of Object.entries(mo || {})) {
      if (fname === '_reserved') {
        mm.reserved = { numbers: (fraw && fraw.numbers || []).map(Number).filter((n) => !isNaN(n)), names: (fraw && fraw.names || []).map(String) };
        continue;
      }
      if (fname === 'options') { mm.options = (fraw && typeof fraw === 'object') ? fraw : {}; continue; }
      mm.fields.push(yamlToField(fname, fraw));
    }
    p.models.push(mm);
  }
  return p;
}

// ---------- 路由 ----------
function defaultHttp(mName, rName) {
  const r = pluralize(rName).toLowerCase();
  switch (mName) {
    case 'Create': return ['POST', '/' + r];
    case 'Get': return ['GET', '/' + r + '/{id}'];
    case 'List': return ['GET', '/' + r];
    case 'Update': return ['PATCH', '/' + r + '/{id}'];
    case 'Delete': return ['DELETE', '/' + r + '/{id}'];
    default: return ['POST', '/' + r + '/' + mName.toLowerCase()];
  }
}
function parseHttp(http) {
  const m = String(http || '').trim().match(/^(GET|POST|PATCH|PUT|DELETE|OPTIONS)\s+(.+)$/i);
  if (m) return [m[1].toUpperCase(), m[2].trim()];
  return null;
}
function resolveRoute(m, rName) {
  const custom = parseHttp(m.http);
  if (custom) return { verb: custom[0], path: custom[1], custom: true };
  const [verb, path] = defaultHttp(m.name, rName);
  return { verb, path, custom: false };
}
// 标准 Get/Update/Delete 若 input 缺 {id}，自动补 path 参数
function ensureIdParam(m, rName, custom) {
  if (custom) return;
  if (!['Get', 'Update', 'Delete'].includes(m.name)) return;
  if (!m.input.some((f) => f.name === 'id')) m.input.unshift(newField({ name: 'id', type: 'string', in: 'path', required: true, desc: rName + ' id' }));
}

// ---------- OpenAPI 3.1 生成 ----------
function fieldSchema(f) {
  switch (f.type) {
    case 'string': return { type: 'string' };
    case 'int': return { type: 'integer' };
    case 'number': return { type: 'number' };
    case 'bool': return { type: 'boolean' };
    case 'timestamp': return { type: 'string', format: 'date-time' };
    case 'enum': return { type: 'string', enum: f.enum || [] };
    case 'array': {
      const items = f.itemsType === 'ref' ? { $ref: '#/components/schemas/' + f.itemsRef } : fieldSchema({ type: f.itemsType, enum: f.itemsType === 'enum' ? (f.enum || []) : [] });
      return { type: 'array', items };
    }
    case 'ref': return { $ref: '#/components/schemas/' + f.ref };
    case 'map': {
      const v = f.mapValueType === 'ref' ? { $ref: '#/components/schemas/' + f.mapValueRef } : fieldSchema({ type: f.mapValueType });
      return { type: 'object', additionalProperties: v };
    }
    default: return { type: 'string' };
  }
}
function objFromFields(fields) {
  const props = {}, required = [], groups = {};
  for (const f of fields) {
    if (!f.name) continue;
    if (f.oneof) { (groups[f.oneof] = groups[f.oneof] || []).push(f); continue; }
    props[f.name] = Object.assign({}, fieldSchema(f), f.desc ? { description: f.desc } : {});
    if (f.required) required.push(f.name);
  }
  const o = { type: 'object', properties: props };
  if (required.length) o.required = required;
  const oneOf = [];
  for (const gname of Object.keys(groups)) {
    for (const f of groups[gname]) {
      const sub = { required: [f.name], properties: {} };
      sub.properties[f.name] = Object.assign({}, fieldSchema(f), f.desc ? { description: f.desc } : {});
      oneOf.push(sub);
    }
  }
  if (oneOf.length) o.oneOf = oneOf;
  return o;
}
function modelToOAS(m) { return objFromFields(m.fields); }
function outputToOAS(out) {
  if (out.kind === 'ref' && out.ref) return { $ref: '#/components/schemas/' + out.ref };
  if (out.kind === 'inline') return objFromFields(out.fields);
  return undefined;
}
// 把示例文本解析为对象（JSON 优先，其次 YAML），失败则原样返回字符串
function parseExample(text) {
  const t = String(text || '').trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch (e) {}
  try { return window.jsyaml.load(t); } catch (e) {}
  return String(text);
}
function toOpenAPI() {
  const schemas = {};
  for (const m of project.models) if (m.name) schemas[m.name] = modelToOAS(m);
  const paths = {};
  for (const r of project.resources) {
    for (const m of r.methods) {
      if (!m.name) continue;
      const route = resolveRoute(m, r.name);
      ensureIdParam(m, r.name, route.custom);
      const parameters = [], bodyFields = [];
      for (const f of m.input) {
        if (f.in === 'path' || f.in === 'query' || f.in === 'header') {
          parameters.push({ name: f.name, in: f.in, required: !!f.required, schema: fieldSchema(f), description: f.desc || undefined });
        } else bodyFields.push(f);
      }
      const op = { operationId: r.name + m.name, tags: [r.name], description: m.desc || undefined, parameters: parameters.length ? parameters : undefined };
      if (m.note) op['x-note'] = m.note;
      if (m.stream && m.stream !== 'none') op['x-streaming'] = m.stream;
      if (bodyFields.length) op.requestBody = { content: { 'application/json': { schema: objFromFields(bodyFields) } } };
      const outSchema = outputToOAS(m.output);
      const respContent = outSchema ? { 'application/json': { schema: outSchema } } : undefined;
      if (respContent && m.example) { const ex = parseExample(m.example); if (ex !== undefined) respContent['application/json'].example = ex; }
      op.responses = { '200': { description: 'OK', content: respContent } };
      for (const code of m.errors) op.responses[String(code)] = { description: 'Error' };
      if (!paths[route.path]) paths[route.path] = {};
      paths[route.path][route.verb.toLowerCase()] = op;
    }
  }
  const info = { title: project.name || 'MyService', version: project.version || '1.0.0' };
  if (project.description) info.description = project.description;
  return { openapi: '3.1.0', info, paths, components: { schemas } };
}

// ---------- protobuf / gRPC 生成 ----------
function collectMethods() {
  const out = [];
  for (const r of project.resources) for (const m of r.methods) if (m.name) out.push({ r, m });
  return out;
}
function protoType(f, ctx) {
  switch (f.type) {
    case 'string': return 'string';
    case 'int': return 'int64';
    case 'number': return 'double';
    case 'bool': return 'bool';
    case 'timestamp': return 'google.protobuf.Timestamp';
    case 'enum': return enumName(ctx, f);
    case 'array': return 'repeated ' + protoElem(f.itemsType, f.itemsRef, ctx, f);
    case 'ref': return f.ref;
    case 'map': {
      const k = 'string';
      const v = protoElem(f.mapValueType, f.mapValueRef, ctx, f);
      return 'map<' + k + ', ' + v + '>';
    }
    default: return 'string';
  }
}
function protoElem(type, ref, ctx, f) {
  if (type === 'ref') return ref || 'string';
  if (type === 'timestamp') return 'google.protobuf.Timestamp';
  if (type === 'enum') return enumName(ctx, f);
  return type === 'int' ? 'int64' : type === 'number' ? 'double' : type === 'bool' ? 'bool' : type;
}
function enumName(ctx, f) { return pascal(ctx) + pascal(f.name) + 'Value'; }
function fmtReservedNumbers(nums) {
  const a = Array.from(new Set((nums || []).map(Number).filter((n) => !isNaN(n) && n > 0))).sort((x, y) => x - y);
  const parts = [];
  let start = a[0], prev = a[0];
  for (let i = 1; i <= a.length; i++) {
    const x = a[i];
    if (x === prev + 1) { prev = x; continue; }
    parts.push(start === prev ? String(start) : start + ' to ' + prev);
    start = x; prev = x;
  }
  return parts.join(', ');
}
function messageText(name, fields, reserved, options) {
  const lines = ['message ' + name + ' {'];
  const used = new Set();
  const resvNums = (reserved && reserved.numbers) || [];
  const groups = {};
  const emitField = (f, indent) => {
    let n = (f.tag > 0) ? f.tag : 0;
    if (n <= 0) { do { n++; } while (used.has(n) || resvNums.includes(n)); }
    used.add(n);
    const opts = optNonEmpty(f.options) ? ' [' + protoOptionsInline(f.options) + ']' : '';
    lines.push(indent + protoType(f, name) + ' ' + snake(f.name) + ' = ' + n + opts + ';');
  };
  for (const f of fields) {
    if (!f.name) continue;
    if (f.oneof) { (groups[f.oneof] = groups[f.oneof] || []).push(f); continue; }
    emitField(f, '  ');
  }
  for (const gname of Object.keys(groups)) {
    lines.push('  oneof ' + snake(gname) + ' {');
    for (const f of groups[gname]) emitField(f, '    ');
    lines.push('  }');
  }
  const msgOpts = optNonEmpty(options);
  if (msgOpts) Object.keys(msgOpts).forEach((k) => lines.push('  option ' + k + ' = ' + optVal(msgOpts[k]) + ';'));
  if (reserved && reserved.names && reserved.names.length) lines.push('  reserved ' + reserved.names.map((x) => '"' + x + '"').join(', ') + ';');
  if (resvNums.length) lines.push('  reserved ' + fmtReservedNumbers(resvNums) + ';');
  lines.push('}');
  return lines.join('\n');
}
function toProto() {
  const pkg = (project.name || 'service').toLowerCase().replace(/[^a-z0-9_.]/g, '_');
  const chunks = ['syntax = "proto3";', '', 'package ' + pkg + ';'];
  const importList = [];
  const addImport = (imp) => { if (imp && !importList.includes(imp)) importList.push(imp); };
  let usesTs = false, usesEmpty = false;
  // 收集枚举
  const enumBlocks = [];
  const seenEnums = {};
  function addEnum(ctx, f) {
    const nm = enumName(ctx, f);
    if (seenEnums[nm] || !f.enum || !f.enum.length) return;
    seenEnums[nm] = true;
    const lines = ['enum ' + nm + ' {', '  ' + nm + '_UNSPECIFIED = 0;'];
    f.enum.forEach((v, i) => lines.push('  ' + nm + '_' + snake(v).toUpperCase() + ' = ' + (i + 1) + ';'));
    lines.push('}');
    enumBlocks.push(lines.join('\n'));
  }
  for (const m of project.models) for (const f of m.fields) if (f.type === 'enum') addEnum(m.name, f);
  for (const { m } of collectMethods()) {
    for (const f of m.input) if (f.type === 'enum') addEnum(m.name + m.name + 'Request', f);
    if (m.output.kind === 'inline') for (const f of m.output.fields) if (f.type === 'enum') addEnum(m.name + m.name + 'Response', f);
  }
  // models
  for (const m of project.models) {
    if (!m.name) continue;
    chunks.push(messageText(m.name, m.fields, m.reserved, m.options));
    for (const f of m.fields) if (f.type === 'timestamp') usesTs = true;
  }
  // services + request/response
  for (const r of project.resources) {
    const svc = ['service ' + pascal(r.name) + 'Service {'];
    for (const m of r.methods) {
      if (!m.name) continue;
      const ctx = m.name;
      const reqName = pascal(r.name) + ctx + 'Request';
      let respName;
      if (m.output.kind === 'ref' && m.output.ref) respName = m.output.ref;
      else if (m.output.kind === 'inline') respName = pascal(r.name) + ctx + 'Response';
      else { respName = 'google.protobuf.Empty'; usesEmpty = true; }
      if (m.note) svc.push('  // ' + String(m.note).split('\n').join('\n  // '));
      const streamIn = (m.stream === 'client' || m.stream === 'bidi') ? 'stream ' : '';
      const streamOut = (m.stream === 'server' || m.stream === 'bidi') ? 'stream ' : '';
      const mopts = optNonEmpty(m.options);
      if (mopts) {
        svc.push('  rpc ' + ctx + '(' + streamIn + reqName + ') returns (' + streamOut + respName + ') {');
        Object.keys(mopts).forEach((k) => svc.push('    option ' + k + ' = ' + optVal(mopts[k]) + ';'));
        svc.push('  }');
      } else {
        svc.push('  rpc ' + ctx + '(' + streamIn + reqName + ') returns (' + streamOut + respName + ');');
      }
      chunks.push(messageText(reqName, m.input));
      for (const f of m.input) if (f.type === 'timestamp') usesTs = true;
      if (m.output.kind === 'inline') {
        chunks.push(messageText(respName, m.output.fields));
        for (const f of m.output.fields) if (f.type === 'timestamp') usesTs = true;
      }
    }
    svc.push('}');
    chunks.push(svc.join('\n'));
  }
  if (enumBlocks.length) chunks.push(enumBlocks.join('\n\n'));
  if (usesTs) addImport('google/protobuf/timestamp.proto');
  if (usesEmpty) addImport('google/protobuf/empty.proto');
  for (const imp of (project.imports || [])) addImport(imp);
  const pkgIdx = chunks.findIndex((c) => c.startsWith('package '));
  for (let i = importList.length - 1; i >= 0; i--) chunks.splice(pkgIdx + 1, 0, 'import "' + importList[i] + '";');
  const fileOpts = optNonEmpty(project.options);
  if (fileOpts) {
    const optLines = Object.keys(fileOpts).map((k) => 'option ' + k + ' = ' + optVal(fileOpts[k]) + ';');
    chunks.splice(pkgIdx + 1 + importList.length, 0, ...optLines);
  }
  return chunks.filter((c) => c.trim() !== '').join('\n\n') + '\n';
}

// ---------- 渲染 ----------
function renderTree() {
  const kw = ($('filter').value || '').trim().toLowerCase();
  const el = $('tree');
  el.innerHTML = '';
  const group = (title, keyLetter) => {
    const g = document.createElement('div'); g.className = 'tree-group';
    const h = document.createElement('div'); h.className = 'tree-group-head';
    h.innerHTML = '<span>' + title + '</span><span class="plus" title="新增 ' + keyLetter + '">＋</span>';
    const kh = document.createElement('span'); kh.className = 'keyhint';
    kh.innerHTML = keycapHint(keyLetter);
    h.appendChild(kh);
    g.appendChild(h); el.appendChild(g);
    return { g, head: h };
  };
  const resGroup = group('资源', 'R');
  resGroup.head.querySelector('.plus').onclick = addResource;
  for (const r of project.resources) {
    if (kw && !(r.name || '').toLowerCase().includes(kw)) continue;
    const item = treeItem(r.name, r.methods.length + ' 方法', sel.kind === 'resource' && sel.id === r.id, () => select('resource', r.id));
    item.dataset.del = 'r' + r.id;
    item.title = '点击编辑资源；方法在其下';
    resGroup.g.appendChild(item);
    for (const m of r.methods) {
      const mi = treeItem('  ' + m.name, resolveRoute(m, r.name).verb, sel.kind === 'method' && sel.id === m.id, () => select('method', m.id));
      mi.className += ' tree-method';
      resGroup.g.appendChild(mi);
    }
  }
  const modelGroup = group('模型', 'M');
  modelGroup.head.querySelector('.plus').onclick = addModel;
  for (const m of project.models) {
    if (kw && !(m.name || '').toLowerCase().includes(kw)) continue;
    modelGroup.g.appendChild(treeItem(m.name, m.fields.length + ' 字段', sel.kind === 'model' && sel.id === m.id, () => select('model', m.id)));
  }
  $('countLabel').textContent = project.resources.length + ' 资源 · ' + project.models.length + ' 模型';
}
function treeItem(label, meta, active, onclick) {
  const it = document.createElement('div');
  it.className = 'tree-item' + (active ? ' active' : '');
  it.innerHTML = '<code>' + esc(label) + '</code><span class="mcount">' + esc(meta || '') + '</span>';
  it.onclick = onclick;
  return it;
}

function select(kind, id) {
  sel = { kind, id };
  renderTree();
  renderForm();
}
function openProjectInfo() { sel = { kind: null, id: null }; renderTree(); renderForm(); }
function openNewProject() {
  if (confirm('新建项目将清空当前所有数据并回到 Node 示例，确认？')) {
    project = defaultProject();
    sel = { kind: null, id: null };
    refreshDerived(); renderTree(); renderForm();
    addLog('info', '新建项目（Node 示例）', ['已清空当前数据，回到默认示例，按 Ctrl+S 保存']);
    saveStatus('已新建 Node 示例项目（未保存）');
  }
}
function exportProject() {
  const root = toYamlSource(); root.idlstudio = '0.3';
  const text = window.jsyaml.dump(root, { lineWidth: 120 });
  const name = (project.name || 'project').replace(/[^\w.-]+/g, '_');
  const ver = project.version || '1.0.0';
  downloadText(text, name + '-v' + ver + '.didl', 'text/yaml');
  saveStatus('已导出项目 IDL');
}
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
function importIdlFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const root = window.jsyaml.load(String(r.result || ''));
      const p = parseYamlToProject(root || {});
      if (confirm('导入 IDL 将覆盖当前项目（未保存改动将丢失），确认？')) {
        project = p; sel = { kind: null, id: null };
        refreshDerived(); renderTree(); renderForm();
        const nM = p.resources.reduce((a, x) => a + x.methods.length, 0);
        addLog('info', '导入 IDL 成功：' + (p.name || '') + ' v' + (p.version || ''), ['资源 ' + p.resources.length + ' · 模型 ' + p.models.length + ' · 方法 ' + nM]);
        saveStatus('已导入 IDL 项目');
      }
    } catch (e) {
      addLog('error', '导入 IDL 失败', [e.message]);
      saveStatus('导入失败：' + e.message);
    }
  };
  r.readAsText(file);
}
function renderForm() {
  const head = $('formHead'), body = $('formBody');
  head.innerHTML = ''; body.innerHTML = '';
  if ($('specBadge')) $('specBadge').classList.toggle('active', !sel.kind);
  let title = '', tag = '', desc = '';
  if (sel.kind === 'resource') {
    const r = findRes(sel.id); if (!r) return;
    tag = '资源'; title = r.name || '(未命名资源)'; desc = r.desc || '';
    head.innerHTML = '<span class="kind-tag">' + tag + '</span><span class="ftitle">' + esc(title) + '</span><input class="fld grow" id="resName" value="' + esc(r.name) + '" placeholder="资源名（如 Node）"><input class="fld grow" id="resDesc" value="' + esc(r.desc) + '" placeholder="描述">';
    bindText('resName', (v) => { r.name = v; refreshDerived(); });
    bindText('resDesc', (v) => { r.desc = v; refreshDerived(); });
    // methods
    body.innerHTML = '<div class="group-label">方法</div><div class="mlist" id="mlist"></div><div class="actions"><button class="btn" id="addMethod">＋ 方法<span class="keyhint">' + keycapHint('E') + '</span></button><button class="btn danger" id="delRes">删除资源</button></div>';
    const ml = $('mlist');
    for (const m of r.methods) {
      const row = document.createElement('div'); row.className = 'mitem';
      row.innerHTML = '<span class="mname">' + esc(m.name || '(未命名)') + '</span><span class="mroute">' + esc(resolveRoute(m, r.name).verb + ' ' + resolveRoute(m, r.name).path) + '</span><span class="mact del" title="删除方法">✕</span>';
      row.onclick = (e) => { if (e.target.classList.contains('del')) return; select('method', m.id); };
      row.querySelector('.del').onclick = (e) => { e.stopPropagation(); if (confirm('删除方法 ' + (m.name || '') + '？')) { r.methods = r.methods.filter((x) => x.id !== m.id); refreshDerived(); renderForm(); renderTree(); } };
      ml.appendChild(row);
    }
    $('addMethod').onclick = () => { const nm = newMethod(); r.methods.push(nm); refreshDerived(); renderForm(); renderTree(); };
    $('delRes').onclick = () => { if (confirm('删除资源 ' + (r.name || '') + ' 及其全部方法？')) { project.resources = project.resources.filter((x) => x.id !== r.id); sel = { kind: null, id: null }; refreshDerived(); renderTree(); renderForm(); } };
    return;
  }
  if (sel.kind === 'model') {
    const m = findModel(sel.id); if (!m) return;
    if (!m.reserved) m.reserved = { numbers: [], names: [] };
    tag = '模型'; title = m.name || '(未命名模型)'; desc = m.desc || '';
    head.innerHTML = '<span class="kind-tag">' + tag + '</span><span class="ftitle">' + esc(title) + '</span><input class="fld grow" id="mName" value="' + esc(m.name) + '" placeholder="模型名"><input class="fld grow" id="mDesc" value="' + esc(m.desc) + '" placeholder="描述">';
    bindText('mName', (v) => { m.name = v; refreshDerived(); });
    bindText('mDesc', (v) => { m.desc = v; refreshDerived(); });
    body.innerHTML = '<div class="group-label">字段</div><div id="flds"></div><div class="actions"><button class="btn" id="addFld">＋ 字段<span class="keyhint">' + keycapHint('F') + '</span></button><button class="btn danger" id="delModel">删除模型</button></div>' +
      '<div class="group-label adv-toggle" id="advToggle">高级(proto)属性 ▸</div>' +
      '<div class="adv" id="advBody" hidden>' +
      '<label class="fld grow"><span>reserved 编号（逗号分隔，proto 线兼容保护）</span><input id="resNumbers" value="' + esc((m.reserved.numbers || []).join(',')) + '" placeholder="2, 15, 9 to 11"></label>' +
      '<label class="fld grow"><span>reserved 名称（逗号分隔）</span><input id="resNames" value="' + esc((m.reserved.names || []).join(',')) + '" placeholder="old_field, obsolete"></label>' +
      '<label class="fld grow"><span>options（proto message 级，JSON）</span><textarea id="modOptions" class="code" rows="2" placeholder=' + "'" + '{"deprecated": true}' + "'" + '>' + esc(optsToText(m.options)) + '</textarea></label>' +
      '</div>';
    const fc = $('flds'); m.fields.forEach((f) => fc.appendChild(fieldRow(f, 'model')));
    $('addFld').onclick = () => { m.fields.push(newField()); refreshDerived(); renderForm(); };
    $('delModel').onclick = () => { if (confirm('删除模型 ' + (m.name || '') + '？')) { project.models = project.models.filter((x) => x.id !== m.id); sel = { kind: null, id: null }; refreshDerived(); renderTree(); renderForm(); } };
    const advToggle = $('advToggle'), advBody = $('advBody');
    advToggle.onclick = () => { advBody.hidden = !advBody.hidden; advToggle.textContent = advBody.hidden ? '高级(proto)属性 ▸' : '高级(proto)属性 ▾'; };
    bindText('resNumbers', (v) => { m.reserved.numbers = v.split(/[,，\s]+/).map(Number).filter((n) => !isNaN(n)); refreshDerived(); });
    bindText('resNames', (v) => { m.reserved.names = v.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean); refreshDerived(); });
    bindText('modOptions', (v) => { m.options = parseOptions(v); refreshDerived(); });
    return;
  }
  if (sel.kind === 'method') {
    const fm = findMethod(sel.id); if (!fm) return;
    const { r, m } = fm;
    const route = resolveRoute(m, r.name);
    tag = '方法'; title = r.name + ' · ' + (m.name || '(未命名)');
    head.innerHTML = '<span class="kind-tag">' + tag + '</span><span class="ftitle">' + esc(title) + '</span>';
    // 方法字段
    body.innerHTML =
      '<div class="row wrap">' +
      '<label class="fld"><span>方法名</span><input id="mName" value="' + esc(m.name) + '" placeholder="Create"></label>' +
      '<label class="fld"><span>路由（留空用标准方法默认）</span><input id="mHttp" value="' + esc(m.http) + '" placeholder="POST /nodes"></label>' +
      '<label class="fld sm"><span>当前</span><input value="' + esc(route.verb + ' ' + route.path) + '" readonly></label>' +
      '<label class="fld sm"><span>流类型</span><select id="mStream"><option value="none">none</option><option value="server">server</option><option value="client">client</option><option value="bidi">bidi</option></select></label>' +
      '</div>' +
      '<label class="fld grow"><span>描述</span><input id="mDesc" value="' + esc(m.desc) + '" placeholder="描述"></label>' +
      '<label class="fld grow"><span>备注说明</span><textarea id="mNote" class="code" rows="2" placeholder="写该方法的备注、注意事项、调用说明等（仅文档用途，不影响生成契约）">' + esc(m.note) + '</textarea></label>' +
      '<label class="fld grow"><span>预期正常返回示例（200）</span><textarea id="mExample" class="code" rows="3" placeholder=' + "'" + '{"id":"1","name":"示例","status":"published"}' + "'" + '>预期返回的示例 JSON/YAML；填写后调试台发送 200 时直接用它作为响应</textarea>' + '</label>' +
      '<label class="fld grow"><span>options（proto method 级，JSON）</span><textarea id="mOpts" class="code" rows="2" placeholder=' + "'" + '{"deprecated": true}' + "'" + '>' + esc(optsToText(m.options)) + '</textarea></label>' +
      '<div class="group-label">输入字段 input</div><div id="inflds"></div><button class="btn sm" id="addIn">＋ 输入字段</button>' +
      '<div class="group-label">输出 output</div>' +
      '<div class="row wrap">' +
      '<label class="fld sm"><span>输出类型</span><select id="outKind"><option value="void">void</option><option value="ref">模型引用</option><option value="inline">内联对象</option></select></label>' +
      '<label class="fld" id="outRefFld"><span>引用模型</span><select id="outRef"></select></label>' +
      '</div>' +
      '<div id="outInline"></div>' +
      '<div class="group-label">错误码 errors</div><div id="errs"></div><button class="btn sm" id="addErr">＋ 错误码</button>' +
      '<div class="actions"><button class="btn danger" id="delMethod">删除方法</button></div>';
    bindText('mName', (v) => { m.name = v; refreshDerived(); });
    bindText('mHttp', (v) => { m.http = v; refreshDerived(); });
    const mStream = $('mStream'); mStream.value = m.stream || 'none';
    mStream.onchange = () => { m.stream = mStream.value; refreshDerived(); };
    bindText('mDesc', (v) => { m.desc = v; refreshDerived(); });
    bindText('mNote', (v) => { m.note = v; refreshDerived(); });
    bindText('mExample', (v) => { m.example = v; refreshDerived(); });
    bindText('mOpts', (v) => { m.options = parseOptions(v); refreshDerived(); });
    const inf = $('inflds'); m.input.forEach((f) => inf.appendChild(fieldRow(f, 'input')));
    $('addIn').onclick = () => { m.input.push(newField()); refreshDerived(); renderForm(); };
    $('outKind').value = m.output.kind;
    $('outKind').onchange = () => { m.output.kind = $('outKind').value; refreshDerived(); renderForm(); };
    const outRef = $('outRef');
    outRef.innerHTML = '<option value="">(选择模型)</option>' + project.models.filter((x) => x.name).map((x) => '<option value="' + esc(x.name) + '">' + esc(x.name) + '</option>').join('');
    outRef.value = m.output.ref;
    outRef.onchange = () => { m.output.ref = outRef.value; refreshDerived(); };
    $('outRefFld').style.display = m.output.kind === 'ref' ? '' : 'none';
    if (m.output.kind === 'inline') {
      const oi = $('outInline');
      oi.innerHTML = '<div class="group-label">内联输出字段</div><div id="outflds"></div><button class="btn sm" id="addOut">＋ 输出字段</button>';
      const of = $('outflds'); m.output.fields.forEach((f) => of.appendChild(fieldRow(f, 'output')));
      $('addOut').onclick = () => { m.output.fields.push(newField()); refreshDerived(); renderForm(); };
    }
    const errs = $('errs');
    m.errors.forEach((code, i) => {
      const row = document.createElement('div'); row.className = 'field-row';
      row.innerHTML = '<input class="fld sm" value="' + esc(code) + '" placeholder="404"><span class="fmeta">HTTP 状态码</span><span class="mact del">✕</span>';
      const inp = row.querySelector('input');
      inp.onchange = () => { m.errors[i] = Number(inp.value) || 0; refreshDerived(); };
      row.querySelector('.del').onclick = () => { m.errors.splice(i, 1); refreshDerived(); renderForm(); };
      errs.appendChild(row);
    });
    $('addErr').onclick = () => { m.errors.push(0); refreshDerived(); renderForm(); };
    $('delMethod').onclick = () => { if (confirm('删除方法 ' + (m.name || '') + '？')) { r.methods = r.methods.filter((x) => x.id !== m.id); sel = { kind: null, id: null }; refreshDerived(); renderTree(); renderForm(); } };
    return;
  }
  // 未选中 -> 项目级设置
  if (!project.imports) project.imports = [];
  head.innerHTML = '<span class="kind-tag">项目</span><span class="ftitle">' + esc(project.name || '') + ' v' + esc(project.version || '') + '</span>';
  body.innerHTML =
    '<label class="fld grow"><span>服务名</span><input id="projName" value="' + esc(project.name || '') + '" placeholder="MyService"></label>' +
    '<label class="fld grow"><span>版本</span><input id="projVersion" value="' + esc(project.version || '') + '" placeholder="1.0.0"></label>' +
    '<label class="fld grow"><span>描述</span><textarea id="projDesc" class="code" rows="2" placeholder="服务简介">' + esc(project.description || '') + '</textarea></label>' +
    '<label class="fld grow"><span>proto imports（每行一个，如 google/protobuf/timestamp.proto）</span><textarea id="projImports" class="code" rows="2" placeholder="google/protobuf/timestamp.proto">' + esc((project.imports || []).join('\n')) + '</textarea></label>' +
    '<label class="fld grow"><span>options（proto 文件级，JSON）</span><textarea id="projOptions" class="code" rows="2" placeholder=' + "'" + '{"java_package": "com.example.msg"}' + "'" + '>' + esc(optsToText(project.options)) + '</textarea></label>' +
    '<div class="group-label">在左侧选择资源 / 方法 / 模型开始设计</div>';
  bindText('projName', (v) => { project.name = v; refreshDerived(); });
  bindText('projVersion', (v) => { project.version = v; refreshDerived(); });
  bindText('projDesc', (v) => { project.description = v; refreshDerived(); });
  $('projImports').addEventListener('input', (e) => { project.imports = e.target.value.split(/\n/).map((s) => s.trim()).filter(Boolean); refreshDerived(); });
  bindText('projOptions', (v) => { project.options = parseOptions(v); refreshDerived(); });
}
function bindText(id, fn) {
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => { fn(el.value); });
}
// 字段行（可复用：model / input / output）
function fieldRow(f, ctx) {
  const row = document.createElement('div'); row.className = 'field-row';
  row.innerHTML =
    '<input class="fname fld" value="' + esc(f.name) + '" placeholder="字段名">' +
    '<label class="fld sm"><select class="ftype"><option value="string">string</option><option value="int">int</option><option value="number">number</option><option value="bool">bool</option><option value="timestamp">timestamp</option><option value="enum">enum</option><option value="array">array</option><option value="ref">ref</option><option value="map">map</option></select></label>' +
    '<label class="fld sm" data-if="loc"><select class="floc"><option value="body">body</option><option value="path">path</option><option value="query">query</option><option value="header">header</option></select></label>' +
    '<label class="fld"><input type="checkbox" class="freq" checked> <span>必填</span></label>' +
    '<span class="fmeta"></span>' +
    '<input class="ftag fld xs" title="proto 字段编号（tag，留空自动）" placeholder="tag" value="' + esc(f.tag || '') + '">' +
    '<input class="foneof fld sm" title="oneof 组名（同组字段归一个互斥组，proto 生成 oneof 块）" placeholder="oneof组" value="' + esc(f.oneof || '') + '">' +
    '<input class="fopts fld xs" title="proto 字段 options（JSON，如 {deprecated:true}）" placeholder="opts" value="' + esc(optNonEmpty(f.options) ? JSON.stringify(f.options) : '') + '">' +
    '<span class="mact del">✕</span>';
  row.querySelector('.ftype').value = f.type;
  if (f.in && ['path', 'query', 'header'].includes(f.in)) row.querySelector('.floc').value = f.in;
  const freq = row.querySelector('.freq'); freq.checked = f.required;
  if (ctx === 'model' || ctx === 'output') row.querySelector('[data-if="loc"]').style.display = 'none';
  row.querySelector('.fname').oninput = (e) => { f.name = e.target.value; refreshDerived(); };
  row.querySelector('.ftype').onchange = (e) => { f.type = e.target.value; refreshDerived(); renderForm(); };
  row.querySelector('.floc').onchange = (e) => { f.in = e.target.value; refreshDerived(); };
  freq.onchange = () => { f.required = freq.checked; refreshDerived(); };
  row.querySelector('.ftag').oninput = (e) => { f.tag = parseInt(e.target.value, 10) || 0; refreshDerived(); };
  row.querySelector('.foneof').oninput = (e) => { f.oneof = e.target.value.trim(); refreshDerived(); };
  row.querySelector('.fopts').oninput = (e) => { f.options = parseOptions(e.target.value); refreshDerived(); };
  row.querySelector('.del').onclick = (e) => { e.stopPropagation(); removeField(f, ctx); };
  // 类型相关附加控件
  const meta = row.querySelector('.fmeta');
  if (f.type === 'enum') {
    meta.innerHTML = '<input class="fld grow" value="' + esc((f.enum || []).join(',')) + '" placeholder="枚举值，逗号分隔">';
    meta.querySelector('input').oninput = (e) => { f.enum = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); refreshDerived(); };
  } else if (f.type === 'array') {
    meta.innerHTML = '<select class="fld"><option value="string">string</option><option value="int">int</option><option value="number">number</option><option value="bool">bool</option><option value="timestamp">timestamp</option><option value="ref">ref</option></select><input class="fld sm" placeholder="ref 模型名">';
    meta.querySelector('select').value = f.itemsType;
    meta.querySelector('select').onchange = (e) => { f.itemsType = e.target.value; refreshDerived(); renderForm(); };
    meta.querySelector('input').value = f.itemsRef;
    meta.querySelector('input').oninput = (e) => { f.itemsRef = e.target.value; refreshDerived(); };
  } else if (f.type === 'ref') {
    meta.innerHTML = '<input class="fld grow" value="' + esc(f.ref) + '" placeholder="模型名（如 Node）">';
    meta.querySelector('input').oninput = (e) => { f.ref = e.target.value; refreshDerived(); };
  } else if (f.type === 'map') {
    meta.innerHTML = '<span class="fmeta">value:</span><select class="fld sm"><option value="string">string</option><option value="int">int</option><option value="number">number</option><option value="bool">bool</option><option value="timestamp">timestamp</option><option value="ref">ref</option></select><input class="fld sm" placeholder="ref 模型名">';
    meta.querySelector('select').value = f.mapValueType;
    meta.querySelector('select').onchange = (e) => { f.mapValueType = e.target.value; refreshDerived(); renderForm(); };
    meta.querySelector('input').value = f.mapValueRef;
    meta.querySelector('input').oninput = (e) => { f.mapValueRef = e.target.value; refreshDerived(); };
  }
  return row;
}
function removeField(f, ctx) {
  const remove = (arr) => { const i = arr.indexOf(f); if (i >= 0) arr.splice(i, 1); };
  if (ctx === 'input') { for (const { m } of collectMethods()) if (m.input.indexOf(f) >= 0) remove(m.input); }
  else if (ctx === 'output') { for (const { m } of collectMethods()) if (m.output.kind === 'inline' && m.output.fields.indexOf(f) >= 0) remove(m.output.fields); }
  else { for (const m of project.models) if (m.fields.indexOf(f) >= 0) remove(m.fields); }
  refreshDerived(); renderForm();
}
function addResource() {
  const r = newResource({ name: 'NewResource' }); r.methods.push(newMethod({ name: 'Get' }));
  project.resources.push(r); refreshDerived(); renderTree(); select('resource', r.id);
}
function addModel() {
  const m = newModel({ name: 'NewModel' });
  project.models.push(m); refreshDerived(); renderTree(); select('model', m.id);
}

// ---------- 派生刷新（源码 + 预览 + 调试） ----------
function refreshDerived() {
  renderSource();
  renderOpenapi();
  renderProto();
  if (activeTab === 'debug') renderDebug();
  renderTree();
  $('specBadge').textContent = project.name + ' v' + project.version;
}
function renderSource() {
  if (document.activeElement === $('sourceInput')) return; // 用户在源码里输入时不覆盖
  try { $('sourceInput').value = window.jsyaml.dump(toYamlSource(), { lineWidth: 120 }); }
  catch (e) { /* 忽略 */ }
}
function renderOpenapi() {
  try { $('openapiView').textContent = JSON.stringify(toOpenAPI(), null, 2); } catch (e) { $('openapiView').textContent = '生成失败：' + e.message; }
}
function renderProto() {
  try { $('protoView').textContent = toProto(); } catch (e) { $('protoView').textContent = '生成失败：' + e.message; }
}
function sourceStatus(msg) {
  const el = $('sourceStatus'); el.textContent = msg;
  clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ''; }, 2500);
}
function onSourceEdit() {
  clearTimeout(onSourceEdit._t);
  onSourceEdit._t = setTimeout(() => {
    const text = $('sourceInput').value;
    try {
      const root = window.jsyaml.load(text);
      if (!root || typeof root !== 'object') throw new Error('需为 YAML 对象');
      project = parseYamlToProject(root);
      refreshDerived();
      sourceStatus('已解析回填表单');
    } catch (e) {
      sourceStatus('YAML 语法错误：' + e.message);
    }
  }, 400);
}

// ---------- 调试台（mock） ----------
let debugSel = null;
function renderDebug() {
  const el = $('debugForm');
  const methods = collectMethods();
  const items = methods.map(({ r, m }) => ({
    key: r.id + '.' + m.id,
    label: r.name + '.' + m.name + '  (' + resolveRoute(m, r.name).verb + ' ' + resolveRoute(m, r.name).path + ')'
  }));
  const selItem = items.find((i) => i.key === debugSel);
  const opts = items.map((i) => '<option value="' + esc(i.label) + '"></option>').join('');
  el.innerHTML =
    '<div class="debug-head"><input id="dbgMethod" list="dbgMethodList" placeholder="输入方法名匹配…" value="' + (selItem ? esc(selItem.label) : '') + '">' +
    '<datalist id="dbgMethodList">' + opts + '</datalist></div>' +
    '<div id="dbgBody"></div>';
  const inp = $('dbgMethod');
  inp.addEventListener('change', () => {
    const v = inp.value.trim();
    const hit = v ? (items.find((i) => i.label === v || i.key === v) || null) : null;
    debugSel = hit ? hit.key : null;
    renderDebugForm();
  });
  if (debugSel) renderDebugForm();
}
function findMethodByKey(key) {
  const [rid, mid] = key.split('.');
  const r = findRes(rid); if (!r) return null;
  const m = r.methods.find((x) => x.id === mid);
  return m ? { r, m } : null;
}
function renderDebugForm() {
  const db = $('dbgBody'); if (!db) return;
  const fm = findMethodByKey(debugSel); if (!fm) { db.innerHTML = ''; return; }
  const { r, m } = fm;
  db.innerHTML =
    '<div class="group-label">输入</div><div id="dbgin"></div>' +
    '<div class="row wrap"><label class="fld sm"><span>模拟错误码</span><select id="dbgErr"><option value="">(无，返回 200)</option>' + m.errors.map((c) => '<option value="' + c + '">' + c + '</option>').join('') + '</select></label>' +
    '<button class="btn primary" id="dbgSend">发送</button></div>' +
    '<div class="resp-head"><span id="dbgStatus" class="status">—</span><span id="dbgMeta" class="meta"></span><span class="resp-head-spacer"></span><div class="findbar"><span class="find-label">查找</span><input id="dbgFind" type="text" placeholder="关键词/正则"><button class="btn" id="dbgNext">↓</button><span id="dbgCount" class="find-count">0 / 0</span><button class="btn" id="dbgClear">×</button></div></div>' +
    '<div id="dbgResp" class="resp-body"><div class="placeholder">点击「发送」查看 mock 响应。</div></div>';
  const inp = $('dbgin');
  for (const f of m.input) {
    if (!f.name) continue;
    const l = document.createElement('label'); l.className = 'fld';
    l.innerHTML = '<span>' + esc(f.name) + (f.required ? ' <b class="req">*</b>' : '') + ' <small>' + esc(f.in) + '</small></span><input data-f="' + esc(f.id) + '" value="' + esc(sampleScalar(f)) + '">';
    inp.appendChild(l);
  }
  $('dbgSend').onclick = () => sendDebug(fm);
  $('dbgNext').onclick = () => dbgFindMove(1);
  $('dbgClear').onclick = dbgFindClear;
  $('dbgFind').oninput = () => { dbgFindActive = 0; dbgFindApply(); };
  resetDbgFind();
}
function sampleScalar(f) {
  switch (f.type) {
    case 'string': return 'string';
    case 'int': return '1';
    case 'number': return '1.5';
    case 'bool': return 'true';
    case 'timestamp': return '2026-01-01T00:00:00Z';
    case 'enum': return (f.enum && f.enum[0]) || 'VALUE';
    case 'ref': return f.ref;
    case 'array': return '';
    default: return '';
  }
}
function sampleValue(f) {
  switch (f.type) {
    case 'string': return 'string';
    case 'int': return 1;
    case 'number': return 1.5;
    case 'bool': return true;
    case 'timestamp': return '2026-01-01T00:00:00Z';
    case 'enum': return (f.enum && f.enum[0]) || 'VALUE';
    case 'array': {
      const item = { type: f.itemsType, ref: f.itemsRef, enum: f.enum };
      return [sampleValue(item)];
    }
    case 'ref': return sampleModel(f.ref);
    case 'map': { const item = { type: f.mapValueType, ref: f.mapValueRef }; const o = {}; o['key'] = sampleValue(item); return o; }
    default: return null;
  }
}
function sampleModel(name) {
  const m = project.models.find((x) => x.name === name);
  if (!m) return { $ref: name };
  const o = {};
  for (const f of m.fields) if (f.name) o[f.name] = sampleValue(f);
  return o;
}
function sendDebug({ r, m }) {
  const errCode = $('dbgErr').value;
  const statusEl = $('dbgStatus'), metaEl = $('dbgMeta');
  if (errCode) {
    statusEl.textContent = errCode; statusEl.style.color = '#e03131';
    metaEl.textContent = 'application/json';
    setDbgBody(JSON.stringify({ error: { code: errCode, message: 'mock 错误（模拟 ' + errCode + '）' } }, null, 2));
  } else {
    statusEl.textContent = '200'; statusEl.style.color = '#2f9e44';
    metaEl.textContent = 'application/json';
    if (m.example && String(m.example).trim()) setDbgBody(prettyExample(m.example));
    else if (m.output.kind === 'void') setDbgBody('(void)');
    else if (m.output.kind === 'ref') setDbgBody(JSON.stringify(sampleModel(m.output.ref), null, 2));
    else { const o = {}; for (const f of m.output.fields) if (f.name) o[f.name] = sampleValue(f); setDbgBody(JSON.stringify(o, null, 2)); }
  }
}
function prettyExample(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
  try { return JSON.stringify(window.jsyaml.load(text), null, 2); } catch (e) {}
  return String(text);
}
function setDbgBody(text) {
  dbgLastRaw = text || '';
  dbgFindActive = 0; dbgFindApply();
}

// 调试台查找
let dbgFindActive = -1, dbgFindMarks = [], dbgFindTotal = 0, dbgLastRaw = '';
function dbgFindApply() {
  $('dbgResp').innerHTML = '';
  const pre = document.createElement('pre'); pre.className = 'body';
  pre.innerHTML = dbgHighlight($('dbgFind').value, dbgLastRaw);
  $('dbgResp').appendChild(pre);
  dbgFindMarks = Array.from($('dbgResp').querySelectorAll('mark.hit'));
  dbgFindTotal = dbgFindMarks.length;
  if (!dbgFindTotal) dbgFindActive = -1;
  else if (dbgFindActive < 0 || dbgFindActive >= dbgFindTotal) dbgFindActive = 0;
  dbgFindUI();
}
function dbgHighlight(q, text) {
  if (!q) return esc(text);
  let re;
  try { re = new RegExp(q, 'gi'); } catch (e) { re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }
  const out = []; let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out.push(esc(text.slice(last, m.index))); out.push('<mark class="hit">' + esc(m[0]) + '</mark>');
    last = m.index + m[0].length;
  }
  out.push(esc(text.slice(last)));
  return out.join('');
}
function dbgFindUI() {
  $('dbgCount').textContent = dbgFindTotal ? (dbgFindActive + 1) + ' / ' + dbgFindTotal : '0 / 0';
  dbgFindMarks.forEach((el, i) => el.classList.toggle('active', i === dbgFindActive));
  if (dbgFindTotal) dbgFindMarks[dbgFindActive].scrollIntoView({ block: 'nearest' });
}
function dbgFindMove(dir) {
  if (!dbgFindTotal) return;
  dbgFindActive = (dbgFindActive + dir + dbgFindTotal) % dbgFindTotal;
  dbgFindUI();
}
function dbgFindClear() {
  $('dbgFind').value = ''; dbgFindActive = -1; dbgFindTotal = 0;
  dbgFindApply();
}
function resetDbgFind() {
  dbgFindActive = -1; dbgFindTotal = 0; dbgLastRaw = '';
  const el = $('dbgCount'); if (el) el.textContent = '0 / 0';
}

// ---------- 主题 / 布局 / tabs / 持久化 ----------
function initTheme() {
  try { dark = localStorage.getItem('ads_theme') === 'dark'; } catch (e) {}
  const btn = $('themeToggle');
  const apply = () => {
    document.body.classList.toggle('dark', dark);
    btn.textContent = dark ? '暗夜' : '浅色';
    btn.title = dark ? '当前暗夜模式，点击切换为浅色' : '当前浅色模式，点击切换为暗夜';
  };
  btn.onclick = () => { dark = !dark; apply(); try { localStorage.setItem('ads_theme', dark ? 'dark' : 'light'); } catch (e) {} };
  apply();
}
function initResizer() {
  const pan = $('rightpan'), rz = $('bufResizer');
  const MIN = 300, MAX = 760;
  try { const w = parseInt(localStorage.getItem('ads_w'), 10); if (w >= MIN && w <= MAX) pan.style.width = w + 'px'; } catch (e) {}
  rz.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const startX = ev.clientX, startW = pan.getBoundingClientRect().width;
    rz.classList.add('dragging'); document.body.classList.add('resizing');
    const move = (e) => { let w = startW + (startX - e.clientX); if (w < MIN) w = MIN; if (w > MAX) w = MAX; pan.style.width = w + 'px'; };
    const up = () => {
      rz.classList.remove('dragging'); document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      try { localStorage.setItem('ads_w', String(pan.getBoundingClientRect().width | 0)); } catch (e) {}
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
}
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      activeTab = b.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== 'panel-' + b.dataset.tab; });
      if (activeTab === 'debug') renderDebug();
      if (activeTab === 'source') refreshDerived();
      if (activeTab === 'log') renderLog();
    };
  });
  $('copyOpenapi').onclick = () => copyText($('openapiView').textContent, 'OpenAPI 已复制');
  $('copyProto').onclick = () => copyText($('protoView').textContent, 'proto 已复制');
}
function copyText(text, msg) {
  if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => sourceStatus(msg)); return; }
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); sourceStatus(msg); } catch (e) {}
  document.body.removeChild(ta);
}
function saveStatus(msg) {
  const el = $('saveStatus'); el.textContent = msg;
  clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ''; }, 2500);
}
async function saveProject() {
  try {
    const r = await fetch('/api/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
    const d = await r.json();
    saveStatus(d.ok ? '已保存到 project.json' : '保存失败');
  } catch (e) { saveStatus('保存失败'); }
}
async function loadProject() {
  try {
    const d = await fetch('/api/project').then((r) => r.json());
    if (d && d.ok && d.project) { project = d.project; if (!project.imports) project.imports = []; refreshDerived(); renderTree(); renderForm(); saveStatus('已载入 project.json'); }
    else saveStatus('本地暂无项目');
  } catch (e) { saveStatus('载入失败'); }
}

// ---------- 日志（导入错误报告 / 丢失记录，localStorage 持久化，上限 200） ----------
let logs = null;
function loadLogs() {
  try { const v = localStorage.getItem('idlstudio_log'); if (!v) return []; const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function persistLogs() {
  try { localStorage.setItem('idlstudio_log', JSON.stringify(logs.slice(0, 200))); } catch (e) {}
}
function addLog(type, title, lines) {
  if (!logs) logs = [];
  logs.unshift({ ts: new Date().toISOString(), type, title, lines: (lines || []).slice(0, 50) });
  logs = logs.slice(0, 200);
  persistLogs();
  if (activeTab === 'log') renderLog();
}
function renderLog() {
  const el = $('logView'); if (!el) return;
  if (!logs || !logs.length) { el.innerHTML = '<div class="placeholder">暂无日志。导入 OpenAPI 产生的错误报告与丢失记录会显示在这里。</div>'; return; }
  const badge = { info: '导入', warn: '丢失', error: '错误' };
  el.innerHTML = logs.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
    const body = (e.lines && e.lines.length) ? '<ul>' + e.lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '';
    return '<div class="log-entry log-' + (e.type || 'info') + '">' +
      '<div class="log-head"><span class="log-time">' + esc(time) + '</span><span class="log-badge">' + esc(badge[e.type] || e.type) + '</span><span class="log-title">' + esc(e.title || '') + '</span></div>' + body +
      '</div>';
  }).join('');
}

// ---------- 导入 OpenAPI ----------
function openImport() {
  $('impText').value = '';
  $('impWarn').innerHTML = '';
  $('importModal').hidden = false;
  $('impText').focus();
}
function closeImport() { $('importModal').hidden = true; }
function showImpWarn(warnings) {
  const el = $('impWarn');
  if (!warnings || !warnings.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="imp-warn-title">导入提示（' + warnings.length + ' 条）：</div><ul>' + warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>';
}
function doImport() {
  const text = $('impText').value;
  try {
    const res = window.parseOpenApiText(text);
    const p = res.project;
    if (!p.imports) p.imports = [];
    project = p;
    sel = { kind: null, id: null };
    refreshDerived();
    renderTree();
    renderForm();
    showImpWarn(res.warnings);
    saveStatus('已导入 ' + p.resources.length + ' 资源 / ' + p.models.length + ' 模型');
    addLog('info', '导入成功：' + (p.name || '') + ' v' + (p.version || ''), ['资源 ' + p.resources.length + ' · 模型 ' + p.models.length + ' · 方法 ' + p.resources.reduce((a, r) => a + r.methods.length, 0)]);
    if (res.warnings && res.warnings.length) addLog('warn', '导入丢失记录（' + res.warnings.length + ' 条）', res.warnings);
  } catch (e) {
    $('impWarn').innerHTML = '<div class="imp-warn-title">导入失败：</div><ul><li>' + esc(e.message) + '</li></ul>';
    addLog('error', '导入失败', [e.message]);
  }
}

// ---------- 快捷键（中央键位表 + 绑定 + 面板） ----------
const SHORTCUTS = [
  { label: '保存', keys: 'Cmd/Ctrl+S', run: () => saveProject() },
  { label: '导出项目（.didl）', keys: 'Cmd/Ctrl+Shift+S', run: () => exportProject() },
  { label: '载入 project.json', keys: 'Cmd/Ctrl+L', run: () => loadProject() },
  { label: '新增资源', keys: 'Cmd/Ctrl+Shift+R', run: () => newGuard(addResource) },
  { label: '新增模型', keys: 'Cmd/Ctrl+Shift+M', run: () => newGuard(addModel) },
  { label: '新增字段（需选中模型）', keys: 'Cmd/Ctrl+Shift+F', run: addFieldShortcut },
  { label: '新增方法（需选中资源）', keys: 'Cmd/Ctrl+Shift+E', run: addMethodShortcut },
  { label: '聚焦 / 查找（调试台）', keys: 'Cmd/Ctrl+Alt+F', debug: true, run: focusFind },
  { label: '模拟发送（调试台）', keys: 'Cmd/Ctrl+Alt+T', debug: true, run: mockSend },
];
function newGuard(fn) {
  if (activeTab === 'debug') { saveStatus('当前为调试台模式，请切回编辑标签后操作'); return; }
  fn();
}
// 顶栏「＋资源 / ＋模型」与左面板分组头旁的快捷键键帽提示（平台自适应：mac=⌘，win=⌃）
function kcap(g) { return '<kbd class="kc">' + g + '</kbd>'; }
function keycapHint(letter) {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  const M = isMac ? '⌘' : '⌃'; // Cmd(mac) / Ctrl(win)
  return kcap(M) + kcap('⇧') + kcap(letter);
}
function renderKeyHints() {
  const h = $('resKh'); if (h) h.innerHTML = keycapHint('R');
  const m = $('modelKh'); if (m) m.innerHTML = keycapHint('M');
}
function addFieldShortcut() {
  if (activeTab === 'debug') { saveStatus('当前为调试台模式，请切回编辑标签后操作'); return; }
  if (!sel || sel.kind !== 'model' || !findModel(sel.id)) { saveStatus('未选中模型'); return; }
  findModel(sel.id).fields.push(newField()); refreshDerived(); renderForm();
}
function addMethodShortcut() {
  if (activeTab === 'debug') { saveStatus('当前为调试台模式，请切回编辑标签后操作'); return; }
  const r = sel && sel.kind === 'resource' ? findRes(sel.id) : null;
  if (!r) { saveStatus('未选中资源'); return; }
  r.methods.push(newMethod()); refreshDerived(); renderForm(); renderTree();
}
function focusFind() {
  const el = $('dbgFind'); if (el) { el.focus(); el.select(); return; }
  saveStatus('调试台暂无方法，请先选择方法');
}
function mockSend() {
  const el = $('dbgSend'); if (el) { el.click(); return; }
  saveStatus('调试台暂无方法，请先选择方法');
}
function renderShortcuts() {
  const body = $('scBody'); if (!body) return;
  body.innerHTML = SHORTCUTS.map((s) =>
    '<div class="sc-row"><span class="sc-label">' + esc(s.label) + (s.debug ? ' <small>(调试台)</small>' : '') + '</span><code class="sc-keys">' + esc(s.keys) + '</code></div>'
  ).join('');
}
function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    const shift = e.shiftKey, alt = e.altKey;
    const match = SHORTCUTS.find((s) => {
      const ks = s.keys.split('+');
      return ks[ks.length - 1].toLowerCase() === k
        && (ks.indexOf('Shift') > -1) === shift
        && (ks.indexOf('Alt') > -1) === alt;
    });
    if (!match) return;
    if (match.debug && activeTab !== 'debug') return;
    e.preventDefault();
    match.run();
  });
  $('shortcutBtn').onclick = () => { renderShortcuts(); $('shortcutModal').hidden = false; };
  $('scClose').onclick = () => { $('shortcutModal').hidden = true; };
  $('shortcutModal').addEventListener('click', (e) => { if (e.target === $('shortcutModal')) $('shortcutModal').hidden = true; });
}

async function init() {
  $('topExportBtn').onclick = exportProject;
  $('loadBtn').onclick = loadProject;
  $('projBtn').onclick = openNewProject;
  $('specBadge').onclick = openProjectInfo;
  $('exportBtn').onclick = exportProject;
  $('importIdlBtn').onclick = () => $('importIdlInput').click();
  $('importIdlInput').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) importIdlFile(f); e.target.value = ''; };
  $('addResourceBtn').onclick = addResource;
  $('addModelBtn').onclick = addModel;
  $('importBtn').onclick = openImport;
  $('impClose').onclick = closeImport;
  $('impConfirm').onclick = () => { if (confirm('导入会覆盖当前项目（未保存的改动将丢失），确认？')) { doImport(); closeImport(); } };
  $('impFile').onclick = () => $('impFileInput').click();
  $('impFileInput').onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { $('impText').value = String(r.result || ''); $('impWarn').innerHTML = ''; };
    r.readAsText(file);
  };
  $('filter').oninput = renderTree;
  $('sourceInput').addEventListener('input', onSourceEdit);
  // 任意输入框失焦即自动保存当前修改
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) saveProject();
  });
  bindShortcuts();
  renderKeyHints();
  initTheme(); initResizer(); initTabs();
  logs = loadLogs();
  renderLog();
  $('logClear').onclick = () => { logs = []; persistLogs(); renderLog(); };
  try {
    const d = await fetch('/api/project').then((r) => r.json());
    project = (d && d.ok && d.project) ? d.project : defaultProject();
  } catch (e) { project = defaultProject(); }
  refreshDerived();
  renderTree();
  renderForm();
}
window.addEventListener('DOMContentLoaded', init);
