const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function typeHuman(el, text, delay=60) {
  el.focus();
  for (const ch of text) {
    document.execCommand("insertText", false, ch);
    await sleep(delay);
  }
}

async function composeAndSend({to, subject, body, humanDelay=80}) {
  // Open compose
  let composeBtn = document.querySelector('[role="button"][gh="cm"]');
  if (!composeBtn) {
    // Fallback: press "c"
    document.dispatchEvent(new KeyboardEvent("keydown", {key:"c", code:"KeyC", bubbles:true}));
    await sleep(500);
    composeBtn = document.querySelector('[role="button"][gh="cm"]');
  }
  if (composeBtn) { composeBtn.click(); await sleep(500); }

  // To
  const toField = document.querySelector('textarea[name="to"]');
  if (!toField) throw new Error("To field not found");
  toField.focus();
  await typeHuman(toField, to, humanDelay);
  await sleep(250);

  // Subject
  const subj = document.querySelector('input[name="subjectbox"]');
  if (!subj) throw new Error("Subject field not found");
  subj.focus();
  await typeHuman(subj, subject, humanDelay);
  await sleep(250);

  // Body
  const bodyDiv = document.querySelector('div[aria-label="Message Body"]');
  if (!bodyDiv) throw new Error("Body editor not found");
  bodyDiv.focus();
  await typeHuman(bodyDiv, body, humanDelay);
  await sleep(300);

  // Send
  const sendBtn = Array.from(document.querySelectorAll('div[role="button"]'))
    .find(b => b.getAttribute("data-tooltip")?.toLowerCase().includes("send"));
  if (!sendBtn) throw new Error("Send button not found");
  sendBtn.click();

  // Optional: wait for snackbar "Message sent"
  let tries = 10;
  while (tries-- > 0) {
    const snackbar = document.querySelector('span.aT span[role="alert"]') || document.querySelector('span.bAq');
    if (snackbar && /sent/i.test(snackbar.textContent || "")) break;
    await sleep(300);
  }
}

window.addEventListener("message", (ev) => {
  if (!ev?.data || ev.source !== window) return;
  const { type, payload } = ev.data;
  if (type === "AGENT_GMAIL_COMPOSE") {
    composeAndSend(payload).catch(err => {
      console.error("[Gmail Helper] compose failed:", err);
      alert("Compose failed: " + err.message);
    });
  }
});