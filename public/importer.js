'use strict';
// 阶段一：OpenAPI 3.x -> IDL 导入器
// 用法（浏览器）：window.parseOpenApiText(text) -> { project, warnings }
// 用法（node 测试）：const { openApiToModel, parseOpenApiText } = require('./importer.js')
// 说明：把外部 OpenAPI（REST 契约）反解回内部 IDL 模型，用于"导入续写"。
//   有损项以 warnings 形式返回；服务名取 info.title，资源按 tag/路径段分组。

(function () {
  const jsyaml = (typeof window !== 'undefined') ? window.jsyaml : require('js-yaml');

  const pascal = (s) => String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const refName = (ref) => String(ref || '').split('/').pop();

  function newField(o) {
    return Object.assign({ id: uid(), name: '', type: 'string', required: false, in: 'body', desc: '', enum: [], itemsType: 'string', itemsRef: '', ref: '', mapValueType: 'string', mapValueRef: '', tag: 0, oneof: '', options: {} }, o || {});
  }
  function newModel(o) {
    return Object.assign({ id: uid(), name: '', desc: '', fields: [], reserved: { numbers: [], names: [] }, options: {} }, o || {});
  }

  // JSON Schema 片段 -> IDL 字段
  function schemaToField(name, schema, ctxName, models, warnings) {
    const f = newField({ name });
    if (!schema || typeof schema !== 'object') return f;
    if (schema.$ref) { f.type = 'ref'; f.ref = refName(schema.$ref); if (schema.description) f.desc = schema.description; return f; }
    // oneOf -> 合成 oneof 模型：每个选项一个字段，同组归 oneof
    if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
      const synName = ((ctxName ? pascal(ctxName) : '') + pascal(name)) || ('Union' + pascal(name));
      let syn = models.find((m) => m.name === synName);
      if (!syn) {
        syn = newModel({ name: synName, desc: schema.description || '' });
        schema.oneOf.forEach((opt, i) => {
          const optTitle = (opt && (opt.title || opt.description)) ? pascal(opt.title || opt.description) : ('option' + (i + 1));
          const optF = schemaToField(optTitle, opt, synName, models, warnings);
          optF.oneof = 'choice';
          syn.fields.push(optF);
        });
        models.push(syn);
      }
      f.type = 'ref'; f.ref = synName;
      return f;
    }
    const t = schema.type;
    if (schema.format === 'date-time' || schema.format === 'date') { f.type = 'timestamp'; }
    else if (t === 'integer') f.type = 'int';
    else if (t === 'number') f.type = 'number';
    else if (t === 'boolean') f.type = 'bool';
    else if (t === 'string') {
      if (Array.isArray(schema.enum)) { f.type = 'enum'; f.enum = schema.enum.map(String); }
      else f.type = 'string';
    } else if (t === 'array') {
      f.type = 'array';
      const it = schema.items;
      if (it && typeof it === 'object') {
        if (it.$ref) { f.itemsType = 'ref'; f.itemsRef = refName(it.$ref); }
        else if (it.format === 'date-time') f.itemsType = 'timestamp';
        else if (it.type === 'integer') f.itemsType = 'int';
        else if (it.type === 'number') f.itemsType = 'number';
        else if (it.type === 'boolean') f.itemsType = 'bool';
        else if (Array.isArray(it.enum)) { f.itemsType = 'string'; warnings.push('数组元素 enum 未映射（' + name + '）'); }
        else f.itemsType = 'string';
      }
    } else if (t === 'object') {
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        f.type = 'map';
        const v = schema.additionalProperties;
        if (v.$ref) { f.mapValueType = 'ref'; f.mapValueRef = refName(v.$ref); }
        else if (v.format === 'date-time') f.mapValueType = 'timestamp';
        else f.mapValueType = v.type === 'integer' ? 'int' : v.type === 'number' ? 'number' : v.type === 'boolean' ? 'bool' : 'string';
      } else if (schema.properties && Object.keys(schema.properties).length) {
        // 嵌套内联对象 -> 生成合成模型并以 ref 引用
        const synName = ((ctxName ? pascal(ctxName) : '') + pascal(name)) || ('Nested' + pascal(name));
        let syn = models.find((m) => m.name === synName);
        if (!syn) {
          syn = newModel({ name: synName, desc: schema.description || '' });
          const req = Array.isArray(schema.required) ? schema.required : [];
          for (const [pname, psch] of Object.entries(schema.properties)) {
            const pf = schemaToField(pname, psch, synName, models, warnings);
            if (req.includes(pname)) pf.required = true;
            if (psch.description) pf.desc = psch.description;
            syn.fields.push(pf);
          }
          models.push(syn);
        }
        f.type = 'ref'; f.ref = synName;
      } else {
        f.type = 'map'; f.mapValueType = 'string';
      }
    } else { f.type = 'string'; warnings.push('未识别类型映射为 string（' + name + ': ' + (t || '?') + '）'); }
    if (schema.description) f.desc = schema.description;
    return f;
  }

  function groupFromPath(path) {
    const segs = String(path).split('/').filter(Boolean);
    if (!segs.length) return 'Root';
    return pascal(segs[segs.length - 1].replace(/[{}]/g, '') || 'Root');
  }

  function openApiToModel(api, warnings) {
    warnings = warnings || [];
    const models = [];
    // components.schemas -> models
    const compSchemas = (api && api.components && api.components.schemas) || {};
    for (const [sname, sch] of Object.entries(compSchemas)) {
      if (!sname) continue;
      const m = newModel({ name: pascal(sname), desc: (sch && sch.description) || '' });
      if (!sch || typeof sch !== 'object' || sch.type !== 'object' || !sch.properties) {
        warnings.push('schema "' + sname + '" 非 object/properties，已建空模型');
      }
      const req = (sch && Array.isArray(sch.required)) ? sch.required : [];
      for (const [pname, psch] of Object.entries((sch && sch.properties) || {})) {
        const f = schemaToField(pname, psch, sname, models, warnings);
        if (req.includes(pname)) f.required = true;
        m.fields.push(f);
      }
      models.push(m);
    }
    // paths -> resources + methods
    const resources = [];
    const resByKey = {};
    const paths = (api && api.paths) || {};
    for (const [path, pitem] of Object.entries(paths)) {
      if (!pitem || typeof pitem !== 'object') continue;
      for (const [verb, op] of Object.entries(pitem)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(verb)) continue;
        if (!op || typeof op !== 'object') continue;
        const tags = (Array.isArray(op.tags) && op.tags.length) ? op.tags : [groupFromPath(path)];
        const resName = pascal(tags[0]);
        if (!resByKey[resName]) { resByKey[resName] = { id: uid(), name: resName, desc: '', methods: [] }; resources.push(resByKey[resName]); }
        const r = resByKey[resName];
        const mName = op.operationId ? pascal(op.operationId) : pascal(verb + ' ' + resName);
        const m = { id: uid(), name: mName, http: verb.toUpperCase() + ' ' + path, desc: op.summary || '', note: op['x-note'] || op.description || '', example: '', input: [], output: { kind: 'void', ref: '', fields: [] }, errors: [], stream: (op['x-streaming'] && ['server', 'client', 'bidi'].includes(op['x-streaming'])) ? op['x-streaming'] : 'none', options: {} };
        // parameters
        const params = op.parameters || [];
        for (const p of params) {
          if (!p || !p.name) continue;
          const f = schemaToField(p.name, p.schema || { type: 'string' }, mName, models, warnings);
          f.in = (p.in === 'path' || p.in === 'query' || p.in === 'header') ? p.in : 'query';
          if (p.required) f.required = true;
          if (p.description) f.desc = p.description;
          m.input.push(f);
        }
        // requestBody
        const rb = op.requestBody;
        if (rb && rb.content) {
          const vals = Object.values(rb.content);
          const json = rb.content['application/json'] || vals[0];
          const sch = json && json.schema;
          if (sch) {
            if (sch.$ref) {
              m.input.push(newField({ name: 'body', type: 'ref', ref: refName(sch.$ref) }));
            } else if (sch.type === 'object' && sch.properties) {
              const req = Array.isArray(sch.required) ? sch.required : [];
              for (const [pname, psch] of Object.entries(sch.properties)) {
                const f = schemaToField(pname, psch, mName, models, warnings);
                if (req.includes(pname)) f.required = true;
                m.input.push(f);
              }
            } else {
              const f = schemaToField('body', sch, mName, models, warnings);
              m.input.push(f);
            }
          }
        }
        // responses
        const resp = op.responses || {};
        for (const [code, rs] of Object.entries(resp)) {
          if (!rs) continue;
          if (code === '200') {
            const vals = rs.content ? Object.values(rs.content) : [];
            const c = rs.content && (rs.content['application/json'] || vals[0]);
            const sch = c && c.schema;
            if (sch) {
              if (sch.$ref) {
                m.output = { kind: 'ref', ref: refName(sch.$ref), fields: [] };
              } else if (sch.type === 'object' && sch.properties) {
                const fields = [];
                const req = Array.isArray(sch.required) ? sch.required : [];
                for (const [pname, psch] of Object.entries(sch.properties)) {
                  const f = schemaToField(pname, psch, mName, models, warnings);
                  if (req.includes(pname)) f.required = true;
                  fields.push(f);
                }
                m.output = { kind: 'inline', ref: '', fields };
              } else if (sch.type === 'array') {
                warnings.push('200 响应为数组（' + mName + '），映射为内联单字段 items');
                const it = sch.items || {};
                const f = newField({ name: 'items', type: 'array' });
                if (it.$ref) { f.itemsType = 'ref'; f.itemsRef = refName(it.$ref); }
                else f.itemsType = it.type === 'integer' ? 'int' : it.type === 'number' ? 'number' : it.type === 'boolean' ? 'bool' : 'string';
                m.output = { kind: 'inline', ref: '', fields: [f] };
              } else {
                m.output = { kind: 'void', ref: '', fields: [] };
                warnings.push('200 响应非 object/ref，按 void 处理（' + mName + '）');
              }
              if (c.example !== undefined) m.example = typeof c.example === 'string' ? c.example : JSON.stringify(c.example);
            }
          } else {
            const n = Number(code);
            if (!isNaN(n)) m.errors.push(n);
          }
        }
        r.methods.push(m);
      }
    }
    const name = pascal((api && api.info && api.info.title) || 'MyService');
    return { name: name || 'MyService', version: (api && api.info && api.info.version) || '1.0.0', description: (api && api.info && api.info.description) || '', resources, models, imports: [] };
  }

  function parseOpenApiText(text) {
    const warnings = [];
    const t = String(text || '').trim();
    if (!t) throw new Error('内容为空');
    let obj;
    try { obj = JSON.parse(t); }
    catch (e) {
      try { obj = jsyaml.load(t); } catch (e2) { throw new Error('既不是合法 JSON 也不是合法 YAML：' + e2.message); }
    }
    if (!obj || typeof obj !== 'object') throw new Error('解析结果不是对象');
    if (!obj.openapi && !obj.swagger) warnings.push('未识别为 OpenAPI 文档（缺 openapi/swagger 字段），按结构尽力导入');
    if (obj.openapi && String(obj.openapi).indexOf('3') !== 0) warnings.push('非 OpenAPI 3.x（' + obj.openapi + '），部分映射可能不适用');
    if (!obj.paths) warnings.push('文档无 paths，将只导入 components.schemas（模型）');
    return { project: openApiToModel(obj, warnings), warnings };
  }

  if (typeof window !== 'undefined') { window.openApiToModel = openApiToModel; window.parseOpenApiText = parseOpenApiText; }
  else { module.exports = { openApiToModel, parseOpenApiText }; }
})();
