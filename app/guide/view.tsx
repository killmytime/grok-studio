'use client';

import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft } from 'lucide-react';

export default function GuideView({ markdown }: { markdown: string }) {
  return (
    <div className="min-h-dvh bg-black text-zinc-200">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Link href="/" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <ArrowLeft className="h-4 w-4" />
            工作室
          </Link>
          <span className="text-sm font-medium">手册</span>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-8">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="mb-4 text-2xl font-medium tracking-tight text-zinc-100">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-3 mt-10 text-lg font-medium text-zinc-100">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-100">{children}</h3>,
            p: ({ children }) => <p className="mb-3 text-sm leading-7 text-zinc-300">{children}</p>,
            ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-5">{children}</ol>,
            li: ({ children }) => <li className="text-sm leading-7 text-zinc-300">{children}</li>,
            a: ({ href, children }) => <a href={href} className="text-zinc-100 underline decoration-zinc-600 underline-offset-2">{children}</a>,
            strong: ({ children }) => <strong className="font-medium text-zinc-100">{children}</strong>,
            code: ({ children }) => <code className="rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-200">{children}</code>,
            img: ({ src, alt }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={typeof src === 'string' ? src : ''} alt={alt || ''} className="my-4 w-full rounded-lg border border-zinc-800" />
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
