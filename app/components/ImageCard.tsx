'use client';

import { ImageAsset } from '@/app/lib/types';
import { Download, Edit2, RefreshCw, Copy, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  image: ImageAsset;
  onEdit?: (img: ImageAsset) => void;
  onSetCurrent?: (img: ImageAsset) => void;
  onRegen?: (img: ImageAsset) => void;
  onPreview?: (img: ImageAsset) => void;
  onRetry?: (img: ImageAsset) => void;
  compact?: boolean;
}

export default function ImageCard({ image, onEdit, onSetCurrent, onRegen, onPreview, onRetry, compact }: Props) {
  const thumbUrl = `/api/files/${image.thumb_path}`;
  const fullUrl = `/api/files/${image.file_path}`;
  const isError = image.status === 'error';

  const copyPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(image.prompt);
  };

  if (isError) {
    return (
      <div className="image-card mb-3 border-red-800 bg-red-950/50">
        <div className="p-3 text-xs">
          <div className="text-red-400 font-medium mb-1">生成失败</div>
          <div className="text-zinc-400 text-[10px] mb-2 line-clamp-2">{image.prompt}</div>
          <div className="text-[10px] text-red-400 mb-2">{image.error_message}</div>
          <div className="flex gap-1">
            {onRetry && (
              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={(e) => { e.stopPropagation(); onRetry(image); }}>
                重试
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={copyPrompt}>
              复制 Prompt
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `${image.prompt.slice(0, 30)}.${image.mime.split('/')[1] || 'png'}`;
    a.click();
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPreview?.(image);
  };

  return (
    <div className="image-card mb-3 cursor-pointer" onClick={() => onSetCurrent?.(image)}>
      <div className="relative group">
        <div className="w-full max-h-[180px] bg-zinc-900 flex items-center justify-center overflow-hidden">
          <img 
            src={thumbUrl} 
            alt={image.prompt} 
            className="max-w-full max-h-[180px] object-contain" 
          />
        </div>
        <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
          <Button size="icon" variant="secondary" className="h-7 w-7 bg-black/60 hover:bg-black/80" onClick={handleDownload}>
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="secondary" className="h-7 w-7 bg-black/60 hover:bg-black/80" onClick={handlePreview}>
            <Eye className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {!compact && (
        <div className="p-3 text-xs space-y-2">
          <div className="line-clamp-2 text-zinc-400">{image.prompt}</div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <span>{image.aspect_ratio}</span>
            <span>{image.resolution}</span>
            <span>{image.model.split('-').pop()}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {onEdit && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); onEdit(image); }}>
                <Edit2 className="w-3 h-3 mr-1" /> 继续改
              </Button>
            )}
            {onRegen && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); onRegen(image); }}>
                <RefreshCw className="w-3 h-3 mr-1" /> 重绘
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={copyPrompt}>
              <Copy className="w-3 h-3 mr-1" /> Prompt
            </Button>
            {onSetCurrent && (
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); onSetCurrent(image); }}>
                设为当前
              </Button>
            )}
          </div>
          {image.parent_image_id && (
            <div className="text-[10px] text-emerald-400">编辑链 #{image.parent_image_id.slice(0, 8)}</div>
          )}
        </div>
      )}
    </div>
  );
}
