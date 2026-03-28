// src/selectors.ts
export type SelectorMap = Record<string, string[]>;

export const chaicodeSelectors: SelectorMap = {
  // Left sidebar
  auth_menu: [
    "role=link[name=/authentication/i]",
    "text=/^\\s*authentication\\s*$/i",
    "css=nav a:has-text('Authentication')"
  ],
  signup_menu: [
    "role=link[name=/sign\\s*up/i]",
    "text=/^\\s*sign\\s*up\\s*$/i",
    "css=nav a:has-text('Sign Up')"
  ],

  // Form fields (first/last or full)
  full_name: [
    "label=/full\\s*name/i",
    "placeholder=/full\\s*name|your name|name/i",
    "css=input[name='fullName']",
    "css=input[name='name']",
    "css=input[id*='full' i][id*='name' i]",
    "css=input[id*='name' i]"
  ],
  first_name: [
    "label=/first\\s*name/i",
    "placeholder=/first\\s*name|given name/i",
    "css=input[name='firstName']",
    "css=input[id*='first' i][id*='name' i]"
  ],
  last_name: [
    "label=/last\\s*name|surname|family name/i",
    "placeholder=/last\\s*name|surname|family name/i",
    "css=input[name='lastName']",
    "css=input[id*='last' i][id*='name' i]"
  ],

  email: [
    "label=/email/i",
    "placeholder=/email/i",
    "css=input[type='email']",
    "css=input[name*='email' i]"
  ],
  password: [
    "label=/password$/i",                   // ends with Password
    "placeholder=/password$/i",
    "css=input[type='password']",
    "css=input[name*='password' i]"
  ],
  confirm_password: [
    "label=/confirm\\s*password/i",
    "placeholder=/confirm\\s*password/i",
    "css=input[name*='confirm' i][name*='password' i]",
    "css=input[id*='confirm' i][id*='password' i]"
  ],

  submit: [
    "role=button[name=/create account|sign ?up|register|submit/i]",
    "css=button[type='submit']",
    "css=button:has-text('Create Account')",
    "css=button:has-text('Sign Up')"
  ],
   otp_menu: [
    "role=link[name=/verify\\s*otp/i]",
    "text=/^\\s*verify\\s*otp\\s*$/i",
    "css=nav a:has-text('Verify OTP')"
  ],
  otp_input: [
    "label=/otp|verification code/i",
    "placeholder=/otp|code/i",
    "css=input[name*='otp' i]",
    "css=input[id*='otp' i]"
  ],
  verify_button: [
    "role=button[name=/verify( code)?/i]",
    "css=button[type='submit']",
    "css=button:has-text('Verify')"
  ],
};

export function mergeSelectorMaps(base: SelectorMap, suggested: SelectorMap): SelectorMap {
  const out: SelectorMap = { ...base };
  for (const key of Object.keys(suggested)) {
    const proposed = suggested[key] ?? [];
    const existing = out[key] ?? [];
    const seen = new Set<string>();
    out[key] = [...proposed, ...existing].filter(s => {
      const k = s.trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}