import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const distDir = join(root, "dist");

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

await mkdir(distDir, { recursive: true });

const filesToCopy = ["index.html", "styles.css", "app.js", "supabase-config.js"];
await Promise.all(filesToCopy.map((file) => copyFile(join(root, file), join(distDir, file))));

const envJs = `window.__ENV__ = {
  NEXT_PUBLIC_SUPABASE_URL: ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL)},
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}
};
`;

await writeFile(join(distDir, "env.js"), envJs, "utf8");
