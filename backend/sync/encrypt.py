#!/usr/bin/env python3
"""
Encrypt a password for TID platform credentials.
Uses AES-256-GCM — same as backend/tid-crypto.js

Usage:
  python encrypt.py "my-investor-password"

Output: base64-encoded encrypted string
Copy the output and paste into tid_accounts.platform_password_encrypted
"""

import os
import sys
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def get_key():
    raw = os.environ.get("TID_ENCRYPTION_KEY", "")
    if not raw:
        raise SystemExit("ERROR: TID_ENCRYPTION_KEY not set in environment")
    # 64 hex chars = 32 bytes
    if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return bytes.fromhex(raw)
    # Otherwise SHA-256 hash
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_field(plaintext: str) -> str:
    if plaintext is None or plaintext == "":
        return None
    key = get_key()
    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    # ct = ciphertext + 16-byte tag
    tag = ct[-16:]
    enc = ct[:-16]
    combined = iv + tag + enc
    return base64.b64encode(combined).decode("ascii")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python encrypt.py <password>")
        sys.exit(1)
    password = sys.argv[1]
    result = encrypt_field(password)
    print(result)
