// src/x/selectors.twitter.ts
import type { SelectorMap } from "../selectors";

/**
 * Robust selectors for X (Twitter) compose flow.
 * We bias to data-testid targets and avoid the "AI" button.
 */
export const twitterSelectors: SelectorMap = {
  // Editable compose box
  compose_entry: [
    "css=div[role='textbox'][aria-label*='What' i]",
    "css=div[role='textbox'][data-testid^='tweetTextarea_']",
    "css=div.DraftEditor-root div[contenteditable='true']",
    "role=textbox[name=/what'?s happening|post|compose/i]",
  ],

  tweet_textarea: [
    "css=div[role='textbox'][data-testid^='tweetTextarea_']",
    "css=div[role='textbox'][aria-label*='What' i]",
    "css=div.DraftEditor-root div[contenteditable='true']",
    "role=textbox[name=/what'?s happening|post|compose/i]",
  ],

  // Real Post/Tweet button (NOT the "AI" button)
  tweet_submit: [
    // prefer concrete data-testids
    "css=div[data-testid='tweetButtonInline']",
    "css=div[data-testid='tweetButton']",
    // fallback: role by name, but exclude obvious AI label by avoiding exact 'AI'
    "role=button[name=/^(post|tweet)(?!.*ai)$/i]",
  ],
};