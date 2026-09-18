'use client';

import { useState } from 'react';
import { ImageAsset } from '@/app/lib/types';
import ImageCard from './ImageCard';
import { Button } from '@/components/ui/button';
import { Upload, X } from 'lucide-react';

interface Props {
  images: ImageAsset[];
  currentImage: ImageAsset | null;
  onSelectImage: (img: ImageAsset | null) => void;
  onEditImage: (img: ImageAsset) => void;
  onUpload: (file: File) => Promise<void>;
  onPreview?: (img: ImageAsset) => void;
  conversationId: string | null;
  onRetryImage?: (img: ImageAsset) => void;
}

export default function ImagePanel({ images, currentImage, onSelectImage, onEditImage, onUpload, onPreview, conversationId, onRetryImage }: Props) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !conversationId) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const b64 = (ev.target?.result as string).split(',')[1];
        await onUpload(file); // parent handles the actual post
        // Note: actual upload logic in page
      };
      reader.readAsDataURL(file);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-sidebar w-[320px] flex flex-col h-full border-l border-zinc-800">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <div className="font-semibold">图片资产</div>
          <div className="text-xs text-zinc-500">{images.length} 张 · 当前会话</div>
        </div>
        <label className="cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading || !conversationId} />
          <Button size="sm" variant="outline" className="h-8" disabled={!conversationId}>
            <Upload className="w-4 h-4 mr-1" /> 上传
          </Button>
        </label>
      </div>

      <div className="flex-1 overflow-auto p-3 chat-container">
        {images.length === 0 && (
          <div className="text-center text-sm text-zinc-500 py-12">本会话暂无图片<br />发送「生成图片」或上传开始</div>
        )}
        {images.map(img => (
          <div key={img.id} onClick={() => onSelectImage(img)} className={currentImage?.id === img.id ? 'ring-1 ring-blue-500 rounded-lg' : ''}>
            <ImageCard 
              image={img} 
              onEdit={onEditImage}
              onSetCurrent={onSelectImage}
              onPreview={onPreview}
              onRetry={onRetryImage}
              compact={true}
            />
          </div>
        ))}
      </div>

      {currentImage && (
        <div className="border-t border-zinc-800 p-4 text-xs bg-zinc-950">
          <div className="flex justify-between items-center mb-2">
            <div className="font-medium">当前选中</div>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onSelectImage(null)}><X className="w-4 h-4" /></Button>
          </div>
          <div className="text-zinc-400 line-clamp-3 mb-2">{currentImage.prompt}</div>
          <div className="grid grid-cols-2 gap-x-4 text-[10px] text-zinc-500">
            <div>比例: {currentImage.aspect_ratio}</div>
            <div>分辨率: {currentImage.resolution}</div>
            <div>模型: {currentImage.model}</div>
            <div>尺寸: {currentImage.width}×{currentImage.height}</div>
          </div>
          <Button 
            className="w-full mt-3 h-9" 
            onClick={() => onEditImage(currentImage)}
          >
            继续编辑这张图
          </Button>
        </div>
      )}
    </div>
  );
}
