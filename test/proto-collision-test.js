'use strict';
// proto 标识符冲突修复的回归测试（方案 1+2）
// 用法：node test/proto-collision-test.js
// 断言：每个 message 字段名唯一；每个 enum 常量名唯一；冲突被记录为 warn 日志

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 浏览器全局桩（仅为在 node 中加载 app.js）----
function makeEl() {
  return {
    textContent: '', innerHTML: '', value: '', placeholder: '',
    onclick: null, style: {},
    addEventListener() {}, focus() {}, select() {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, querySelector() { return makeEl(); },
  };
}
global.window = { addEventListener() {}, location: { origin: 'http://x' } };
global.document = { getElementById: () => makeEl(), addEventListener() {}, querySelectorAll: () => [] };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(global, 'navigator', { value: { platform: 'MacIntel' }, configurable: true });

// ---- 加载 app.js ----
const appPath = path.join(__dirname, '..', 'public', 'app.js');
vm.runInThisContext(fs.readFileSync(appPath, 'utf8'), { filename: 'app.js' });

// ---- 装载测试项目 ----
project = JSON.parse(fs.readFileSync(path.join(__dirname, 'collision-test.project.json'), 'utf8'));

// ---- 捕获 warn 日志（覆盖全局 addLog）----
const warns = [];
addLog = (type, title) => { if (type === 'warn') warns.push(title); };

// ---- 执行生成 ----
const proto = toProto();

// ---- 校验 ----
let fail = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg); if (!cond) fail++; };

console.log('=== 生成的 proto ===');
console.log(proto);
console.log('=== 冲突警告（应 >= 5 条）===');
warns.forEach((w) => console.log('  - ' + w));

// 1. 字段名唯一（解析 message 块内的字段行）
const msgBlock = (name) => {
  const re = new RegExp('message ' + name + ' \\{([\\s\\S]*?)\\n\\}');
  const m = proto.match(re);
  return m ? m[1] : '';
};
const fieldsOf = (body) => body.split('\n').map((l) => l.trim()).filter((l) => /^\w+ \w+ = \d+/.test(l)).map((l) => l.split(' ')[1]);
const fnames = fieldsOf(msgBlock('Sample'));
check(new Set(fnames).size === fnames.length, 'Sample 字段名唯一（含 oneof 展开）：' + fnames.join(', '));
check(fnames.includes('message') && fnames.includes('message_2'), 'message 与 Message 归一避让为 message / message_2');
check(fnames.includes('kind') && fnames.includes('kind_2'), 'kind 与 Kind 归一避让为 kind / kind_2');

// 2. 枚举常量唯一
const enumBody = (() => { const m = proto.match(/enum SampleStatusValue \{([\s\S]*?)\n\}/); return m ? m[1] : ''; })();
const enumConsts = enumBody.split('\n').map((l) => l.trim()).filter((l) => /^[\w]+ = \d+;$/.test(l)).map((l) => l.split(' = ')[0]);
check(new Set(enumConsts).size === enumConsts.length, 'SampleStatusValue 枚举常量唯一：' + enumConsts.join(', '));
// 枚举三个归一相关值：1st-value→_1ST_VALUE、1st value→_1ST_VALUE_2(冲突避让)、1ST_VALUE→_1_ST_VALUE(不冲突)
check(enumConsts.includes('SampleStatusValue_1ST_VALUE') && enumConsts.includes('SampleStatusValue_1ST_VALUE_2') && enumConsts.includes('SampleStatusValue_1_ST_VALUE'), '1st-value / 1st value / 1ST_VALUE 归一后三者互不重复（_1ST_VALUE / _1ST_VALUE_2 / _1_ST_VALUE）');
check(enumConsts.includes('SampleStatusValue_UNSPECIFIED_2'), '值 Unspecified 与自动 UNSPECIFIED 冲突被避让为 _UNSPECIFIED_2');

// 4. 警告条数（字段 2 + 枚举值冲突 2）
check(warns.length >= 4, 'warn 日志 >= 4 条（字段 2 + 枚举值 2），实际 ' + warns.length);

console.log('\n' + (fail ? ('FAIL ' + fail + ' 项') : '全部通过'));
process.exit(fail ? 1 : 0);
