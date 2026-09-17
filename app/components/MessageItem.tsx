'use client';

import { ImageAsset } from '@/app/lib/types';

interface Props {
  message: {
    id: string;
    role: string;
    content: string;
    created_at: string;
    extra_json?: any;
  };
  images?: ImageAsset[];
}

export default function MessageItem({ message, images = [] }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'}`}>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {message.extra_json?.model && (
          <div className="text-[10px] opacity-60 mt-1">{message.extra_json.model}</div>
        )}
      </div>
    </div>
  );
}
