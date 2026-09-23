import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '画廊 · Grok Studio',
};

export default function GalleryLayout({ children }: { children: ReactNode }) {
  return children;
}
