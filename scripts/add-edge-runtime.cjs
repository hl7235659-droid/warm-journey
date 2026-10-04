const fs = require('fs');

const files = [
  'src/app/admin/inspections/page.tsx',
  'src/app/admin/layout.tsx',
  'src/app/admin/login/page.tsx',
  'src/app/admin/page.tsx',
  'src/app/admin/points/page.tsx',
  'src/app/admin/points/[id]/history/page.tsx',
  'src/app/admin/points/[id]/page.tsx',
  'src/app/admin/reports/page.tsx',
  'src/app/admin/work-orders/page.tsx',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/point/[id]/report/page.tsx',
];

const RUNTIME = "export const runtime = 'edge';";

for (const rel of files) {
  const full = `C:/Users/tebbit/.claude/warm-journey/${rel}`;
  let src = fs.readFileSync(full, 'utf8');

  if (src.includes("runtime = 'edge'")) {
    console.log('· already has runtime:', rel);
    continue;
  }

  if (src.startsWith("'use client'")) {
    // insert after the 'use client' line
    src = src.replace(/^('use client';?\n)/, `$1${RUNTIME}\n`);
  } else {
    src = RUNTIME + '\n' + src;
  }

  fs.writeFileSync(full, src);
  console.log('✓ patched:', rel);
}
console.log('\nDone.');
