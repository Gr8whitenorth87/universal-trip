// Password gate. The trip data is encrypted (AES-GCM, key from PBKDF2 of the password),
// so the site shows nothing useful without it. Once unlocked, the key is kept on this phone.
import { store } from "./util.js";

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function deriveKey(password, blob) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64(blob.salt), iterations: blob.iter },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]
  );
}

export async function decryptWith(key, blob) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function savedKey() {
  const raw = store.get("key", null);
  if (!raw) return null;
  try {
    return await crypto.subtle.importKey("raw", b64(raw), { name: "AES-GCM" }, true, ["decrypt"]);
  } catch { return null; }
}

export async function rememberKey(key) {
  store.set("key", toB64(await crypto.subtle.exportKey("raw", key)));
}

export function forgetKey() { store.set("key", null); }

// Shows the lock screen and resolves with the decrypted data once the right password is entered.
export function askPassword(blob) {
  const wrap = document.getElementById("lock");
  const form = document.getElementById("lockForm");
  const input = document.getElementById("lockPw");
  const msg = document.getElementById("lockMsg");
  const btn = form.querySelector("button");
  wrap.hidden = false;
  document.body.classList.add("locked");
  setTimeout(() => input.focus(), 50);
  return new Promise((resolve) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = input.value;
      if (!pw) return;
      btn.disabled = true;
      msg.textContent = "Unlocking…";
      try {
        const key = await deriveKey(pw, blob);
        const data = await decryptWith(key, blob);
        await rememberKey(key);
        wrap.hidden = true;
        document.body.classList.remove("locked");
        resolve(data);
      } catch {
        msg.textContent = "That password didn't work. Check the capital letter and try again.";
        btn.disabled = false;
        input.select();
      }
    });
  });
}
