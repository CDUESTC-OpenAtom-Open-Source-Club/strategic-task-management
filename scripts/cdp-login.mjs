/* eslint-env node */
/* global WebSocket */
// 通过 CDP 驱动指定 Chrome 实例（独立 profile = 独立 localStorage 会话）
// 用法: node cdp-login.mjs <port> <username> <password>
const [, , port, username, password] = process.argv
const base = `http://localhost:${port}`

async function listTargets() {
  const res = await fetch(`${base}/json/list`)
  return res.json()
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
      setTimeout(() => {
        if (pending.has(msgId)) {
          pending.delete(msgId)
          reject(new Error(`timeout: ${method}`))
        }
      }, 30000)
    })
  return { send, close: () => ws.close() }
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed')
  }
  return result.result.value
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const targets = await listTargets()
  const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:3500'))
  if (!page) throw new Error(`no app page on port ${port}`)

  const { send, close } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Page.enable')

  // 已登录则先退出
  await evaluate(
    send,
    `(() => {
    localStorage.clear();
    sessionStorage.clear();
    return 'cleared';
  })()`
  )
  await send('Page.navigate', { url: 'http://localhost:3500/login' })
  await sleep(3000)

  const snapshot = await evaluate(
    send,
    `(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.map(i => ({ type: i.type, placeholder: i.placeholder, name: i.name }));
  })()`
  )
  console.log('login inputs:', JSON.stringify(snapshot))

  // 填账号密码并提交
  const filled = await evaluate(
    send,
    `(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const text = inputs.find(i => i.type === 'text' || i.type === '');
    const pwd = inputs.find(i => i.type === 'password');
    if (!text || !pwd) return { ok: false, found: inputs.length };
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(text, ${JSON.stringify(username)});
    setVal(pwd, ${JSON.stringify(password)});
    return { ok: true, textVal: text.value, pwdLen: pwd.value.length };
  })()`
  )
  console.log('filled:', JSON.stringify(filled))

  await sleep(500)
  const clicked = await evaluate(
    send,
    `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /登\\s*录/.test(b.innerText));
    if (!btn) return false;
    btn.click();
    return true;
  })()`
  )
  console.log('clicked login:', clicked)

  await sleep(4000)
  const state = await evaluate(
    send,
    `(() => ({
    url: location.pathname,
    user: localStorage.getItem('currentUser'),
    hasToken: Boolean(localStorage.getItem('sism_session_access_token') || localStorage.getItem('access_token')),
    keys: Object.keys(localStorage)
  }))()`
  )
  console.log('after login:', JSON.stringify(state, null, 1))

  close()
}

main().catch(err => {
  console.error('ERROR:', err.message)
  process.exit(1)
})
