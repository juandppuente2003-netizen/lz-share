// LZC: cifrado de archivos de código (funciona igual en TVs viejas, navegador y Node)
// Nombre del archivo = PBKDF2(código, "LZPLUS-NAME-v2"); contenido cifrado con llaves de PBKDF2(código, sal) + HMAC-SHA256.
const LZC = (() => {
  const N = 100000;
  const enc = (s) => new TextEncoder().encode(s);
  const dec = (b) => new TextDecoder().decode(b);
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; a.forEach((x) => { o.set(x, p); p += x.length; }); return o; };
  const hex = (b) => Array.from(b, (x) => (x < 16 ? '0' : '') + x.toString(16)).join('');
  const b64 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const unb64 = (s) => { const t = atob(s), o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i); return o; };
  const rnd = (n) => { const o = new Uint8Array(n); crypto.getRandomValues(o); return o; };
  const sub = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
  // ---- SHA-256 / HMAC / PBKDF2 en JavaScript puro (para navegadores sin crypto.subtle) ----
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256(m) {
    const l = m.length, nb = ((l + 9 + 63) >> 6) << 6, p = new Uint8Array(nb); p.set(m); p[l] = 0x80;
    const bits = l * 8; p[nb - 4] = bits >>> 24; p[nb - 3] = bits >>> 16; p[nb - 2] = bits >>> 8; p[nb - 1] = bits; p[nb - 5] = Math.floor(bits / 4294967296);
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), W = new Uint32Array(64);
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (p[o + i * 4] << 24) | (p[o + i * 4 + 1] << 16) | (p[o + i * 4 + 2] << 8) | p[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) { const a = W[i - 15], b = W[i - 2]; W[i] = (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + W[i - 16] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)) + W[i - 7]; }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32); for (let i = 0; i < 8; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = H[i] >>> 16; out[i * 4 + 2] = H[i] >>> 8; out[i * 4 + 3] = H[i]; }
    return out;
  }
  function hmacJS(key, msg) {
    if (key.length > 64) key = sha256(key);
    const k = new Uint8Array(64); k.set(key);
    const ip = k.map((x) => x ^ 0x36), op = k.map((x) => x ^ 0x5c);
    return sha256(cat(op, sha256(cat(ip, msg))));
  }
  function pbkdf2JS(pass, salt, len) {
    const out = new Uint8Array(len);
    for (let blk = 1, pos = 0; pos < len; blk++) {
      let u = hmacJS(pass, cat(salt, new Uint8Array([blk >>> 24, blk >>> 16, blk >>> 8, blk]))); const t = u.slice();
      for (let i = 1; i < N; i++) { u = hmacJS(pass, u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
      out.set(t.slice(0, Math.min(32, len - pos)), pos); pos += 32;
    }
    return out;
  }
  async function pbkdf2(pass, salt, len) {
    if (sub) { try { const k = await sub.importKey('raw', enc(pass), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await sub.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: N}, k, len * 8)); } catch (e) {} }
    return pbkdf2JS(enc(pass), salt, len);
  }
  async function hmacKey(key) {
    if (sub) { try { const k = await sub.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']); return async (m) => new Uint8Array(await sub.sign('HMAC', k, m)); } catch (e) {} }
    return async (m) => hmacJS(key, m);
  }
  async function keys(code, salt) {
    const master = await pbkdf2(code, salt, 32), h = await hmacKey(master);
    return {e: await hmacKey(await h(enc('enc'))), m: await hmacKey(await h(enc('mac')))};
  }
  async function xor(ek, iv, data) {
    const out = new Uint8Array(data.length);
    for (let i = 0, n = 0; i < data.length; i += 32, n++) {
      const ks = await ek(cat(iv, new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n])));
      for (let j = 0; j < 32 && i + j < data.length; j++) out[i + j] = data[i + j] ^ ks[j];
    }
    return out;
  }
  const clean = (code) => String(code).replace(/\D/g, '');
  return {
    clean,
    name: async (code) => hex(await pbkdf2(clean(code), enc('LZPLUS-NAME-v2'), 16)),
    encrypt: async (code, obj) => {
      const salt = rnd(16), iv = rnd(16), k = await keys(clean(code), salt);
      const d = await xor(k.e, iv, enc(JSON.stringify(obj))), t = await k.m(cat(iv, d));
      return {v: 2, s: b64(salt), i: b64(iv), d: b64(d), t: b64(t)};
    },
    decrypt: async (code, f) => {
      const salt = unb64(f.s), iv = unb64(f.i), d = unb64(f.d), k = await keys(clean(code), salt);
      if (b64(await k.m(cat(iv, d))) !== f.t) throw new Error('código incorrecto');
      return JSON.parse(dec(await xor(k.e, iv, d)));
    },
    _sha256: (s) => hex(sha256(enc(s))),
  };
})();
if (typeof module !== 'undefined') module.exports = LZC;
