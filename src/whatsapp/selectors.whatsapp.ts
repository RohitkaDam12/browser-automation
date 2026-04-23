// src/whatsapp/selectors.whatsapp.ts
import type { SelectorMap } from "../selectors";

/**
 * Selector map for WhatsApp Web (web.whatsapp.com).
 * Ordered by reliability — most stable selectors first.
 * All selectors target the authenticated WhatsApp Web UI.
 */
export const whatsappSelectors: SelectorMap = {

  // ── Search / contact resolution ─────────────────────────────────────────
  // The search box in the left panel — used to find a contact or group by name or number
  search_box: [
    "css=div[contenteditable='true'][data-tab='3']",
    "css=div[aria-label='Search input textbox']",
    "css=p.selectable-text[data-tab='3']",
    "role=textbox[name=/search/i]",
    "css=div[title='Search input textbox']",
  ],

  // First result in the contact/chat search list
  first_search_result: [
    "css=div[aria-label='Search results.'] div[role='listitem']:first-child",
    "css=div[data-testid='cell-frame-container']:first-child",
    "css=div#pane-side div[role='listitem']:first-child",
    "css=span[data-testid='default-user']:first-child",
    "css=div[aria-label='Search results.'] div[tabindex='-1']:first-child",
  ],

  // ── Message compose area ─────────────────────────────────────────────────
  // The main message input box in an open chat
  message_input: [
    "css=div[contenteditable='true'][data-tab='10']",
    "css=div[aria-label='Type a message']",
    "css=footer div[contenteditable='true']",
    "css=div[title='Type a message']",
    "css=p.selectable-text[data-tab='10']",
    "role=textbox[name=/type a message/i]",
  ],

  // Send button (arrow icon) — appears after typing
  send_button: [
    "css=button[data-testid='send']",
    "css=span[data-testid='send']",
    "css=button[aria-label='Send']",
    "css=div[aria-label='Send']",
    "role=button[name=/send/i]",
    "css=span[data-icon='send']",
  ],

  // ── Chat open confirmation ───────────────────────────────────────────────
  // Header of the currently open chat — confirms the right conversation is open
  chat_header: [
    "css=header div[data-testid='conversation-header']",
    "css=div#main header",
    "css=div[data-testid='conversation-panel-wrapper'] header",
    "css=header span[dir='auto'][title]",
  ],

  // The conversation panel — confirms a chat is open and ready
  conversation_panel: [
    "css=div[data-testid='conversation-panel-wrapper']",
    "css=div#main div[role='application']",
    "css=div[tabindex='-1'][data-tab='8']",
  ],

  // ── New chat flow (when contact not in recent list) ──────────────────────
  // "New chat" pencil/compose icon in the left panel header
  new_chat_button: [
    "css=div[data-testid='new-chat-btn']",
    "css=span[data-testid='new-chat-btn']",
    "css=div[aria-label='New chat']",
    "role=button[name=/new chat/i]",
    "css=span[data-icon='new-chat-outline']",
  ],

  // Phone number / name input in the new chat dialog
  new_chat_search: [
    "css=div[data-testid='new-chat-list-search'] div[contenteditable='true']",
    "css=div[aria-label='Search input textbox'][data-tab='3']",
    "css=div[data-testid='compose-search'] div[contenteditable='true']",
    "css=div[role='textbox'][aria-label*='search' i]",
  ],

  // ── Status / confirmation ────────────────────────────────────────────────
  // The last sent message bubble — used to verify message was sent
  last_sent_message: [
    "css=div[data-testid='msg-container']:last-child span.copyable-text",
    "css=div[data-testid='outgoing-msg']:last-child span.copyable-text",
    "css=div[data-testid='msg-meta']:last-child",
  ],
};