import { readFileSync } from 'fs';
import { join } from 'path';
import GuideView from './view';

export default function GuidePage() {
  const raw = readFileSync(join(process.cwd(), 'docs/user-guide.md'), 'utf8');
  const markdown = raw.replace(/\]\(screenshots\//g, '](/guide/');
  return <GuideView markdown={markdown} />;
}
