# Checko ☕️

Welcome to **Checko** – my experimental AI-powered agent that connects automation flows with a simple frontend.  
Think of it like a playground where you can tell AI to **sign up on websites, post tweets, or even send Gmail messages**, and it will just do it.  

YT Demo - [https://www.youtube.com/watch?v=55tbjddRnbE]


---

##  What this project does

We’ve built 3 main scenarios so far:

### 1. **UI.chaicode.com Signup Flow**
- Automatically opens [ui.chaicode.com](https://ui.chaicode.com)  
- Finds the Authentication dropdown → opens Signup form  
- Highlights every field while typing (with human-like typing animation ✍️)  
- Fills first name, last name, email, password, confirm password  
- Submits the form  


### 2. **Twitter Auto-Post Flow**
- Opens **your signed-in Chrome profile** (via Chrome DevTools Protocol or persistent profile copy).  
- Generates a **fresh tweet text** using OpenAI API (no hardcoded templates).  
- Opens the Tweet composer and posts the tweet.  
- Mimics human typing and clicks post.  

### 3. **Gmail Auto-Send Flow** *(via CDP)*  
- Attaches directly to your **existing logged-in Chrome** via CDP port.  
- Opens Gmail inbox, clicks Compose.  
- Fills **To**, **Subject**, and **Body**.  
- Clicks Send.  
- Works safely only with CDP (so no re-login required).  

---

## ⚙️ Tech Stack

- **Backend**:  
  - Node.js + TypeScript  
  - Playwright (automation)  
  - OpenAI API (for tweet/content generation + vision-based selector validation)  
  - CDP (Chrome DevTools Protocol) for Gmail/Twitter with real logged-in Chrome profile  
- **Frontend**:  
  - Vite + React + TypeScript  
  - Tailwind CSS v4 (no config file, using `@tailwindcss/vite`)  
  - Modern starry background + minimal centered UI  

---

## 🛠️ How to run

For detail steps to run at local Pls connect with on Twitter [@i_am_bug]
