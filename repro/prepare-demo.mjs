// Local reproduction only. Uses the normal authenticated management API.
// Audit notes identify automated demo verification, never a real teacher trial.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--local-demo')) throw new Error('仅限本地演示：请明确添加 --local-demo。正式教学应由教师逐题审核。');
process.loadEnvFile(resolve(root, 'apps/api/.env.local'));
const db = new URL(process.env.DATABASE_URL || '');
if (db.hostname !== '127.0.0.1' || !db.pathname.startsWith('/xuetu_repro')) throw new Error('只允许独立的 xuetu_repro 本机数据库配置。');
if (process.env.NODE_ENV === 'production') throw new Error('禁止在生产模式运行本地演示审核。');
const base = `http://127.0.0.1:${process.env.PORT || '53105'}`;
const account = JSON.parse(readFileSync(resolve(root, '.repro-accounts.json'), 'utf8')).admin;
const explanations = [
  ['screening-408-v3-01','A','栈只允许栈顶入栈和出栈，抽象不要求连续内存。'],
  ['screening-408-v3-02','B','有序序列使优化冒泡一趟结束，首元素枢轴二路快排划分不平衡。'],
  ['screening-408-v3-03','B','127+1 超出 8 位补码上界，位模式为 10000000，发生溢出。'],
  ['screening-408-v3-04','B','(16-6)/2=5 位。'],
  ['screening-408-v3-05','A','FIFO 不因命中改变入队次序，最先进入的页面 1 被淘汰。'],
  ['screening-408-v3-06','A','Work=(1,0) 可满足 P1，归还其原 Allocation 后 Work=(1,1)，再满足 P2。'],
  ['screening-408-v3-07','C','无缓存、无转发且无别名时，迭代查询按根、顶级域、权威服务器进行。'],
  ['screening-408-v3-08','B','TCP 提供面向连接、可靠且按序的字节流服务。'],
  ['practice-408-v1-01','B','长度 8 且牺牲一个存储单元，循环队列容量为 7。'],
  ['practice-408-v1-02','C','无向图的三个连通分量为 {1,2,3}、{4,5}、{6}。'],
  ['practice-408-v1-03','A','典型存储层次越远离 CPU，速度越低、容量越大、单位成本越低。'],
  ['practice-408-v1-04','B','C 数组按行优先存储，逐行访问相邻列更有利于空间局部性。'],
  ['practice-408-v1-05','B','互斥信号量已被 P 占用，Q 等待时阻塞。'],
  ['practice-408-v1-06','B','LRU 序列 1,2,3,1,4 中，访问 4 前页面 2 最久未用。'],
  ['practice-408-v1-07','C','/26 的块大小为 64，130 位于 128 至 191，网络地址末字节为 128。'],
  ['practice-408-v1-08','C','跨子网首跳保留最终目的 IP，链路层目的 MAC 为默认网关。'],
];
const login = await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(account),signal:AbortSignal.timeout(15000)});
if (!login.ok) throw new Error(`本机管理员登录失败 HTTP ${login.status}`);
const cookie = login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
if (!cookie) throw new Error('登录未返回会话 Cookie。');
const audit = {checked_at:new Date().toISOString(),scope:'local_demo_automated_review_not_human_teacher_signoff',items:[]};
try {
  for (const [id,answer,rationale] of explanations) {
    const note = `仅用于独立本机复现；Codex 自动化内容校核，非真实教师签审、非试用成效。核对答案 ${answer}：${rationale}`;
    const response = await fetch(base+`/api/v1/manage/questions/${id}/review`,{method:'PATCH',headers:{'content-type':'application/json',cookie},body:JSON.stringify({review_status:'approved',review_note:note}),signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`${id} 本地审核失败 HTTP ${response.status}`);
    audit.items.push({question_id:id,answer,rationale,review_status:'approved'});
  }
} finally {
  await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{'content-type':'application/json',cookie},body:'{}',signal:AbortSignal.timeout(10000)}).catch(()=>{});
  writeFileSync(resolve(root,'local-demo-review.json'),JSON.stringify(audit,null,2));
}
console.log(JSON.stringify({scope:audit.scope,reviewed_count:audit.items.length,audit_file:'local-demo-review.json'}));
