from pathlib import Path

p = Path('backend/server.js')
s = p.read_text(encoding='utf-8')
old = 'function authenticateAdmin, \n  async (req, res, next) {'
new = 'function authenticateAdmin(req, res, next) {'
if old in s:
    s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf-8')
    print('Fixed authenticateAdmin syntax.')
elif new in s:
    print('authenticateAdmin syntax already fixed.')
else:
    raise SystemExit('authenticateAdmin syntax pattern not found')
