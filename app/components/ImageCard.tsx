'use client';

import { ImageAsset } from '@/app/lib/types';
import { Download, Edit2, RefreshCw, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  image: ImageAsset;
  onEdit?: (img: ImageAsset) => void;
  onSetCurrent?: (img: ImageAsset) => void;
  onRegen?: (img: ImageAsset) => void;
  compact?: boolean;
}

export default function ImageCard({ image, onEdit, onSetCurrent, onRegen, compact }: Props) {
  const thumbUrl = `/api/files/${image.thumb_path}`;
  const fullUrl = `/api/files/${image.file_path}`;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `${image.prompt.slice(0, 30)}.${image.mime.split('/')[1] || 'png'}`;
    a.click();
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(image.prompt);
  };

  return (
    <div className="image-card mb-3">
      <div className="relative">
        <img 
          src={thumbUrl} 
          alt={image.prompt} 
          className="w-full aspect-square object-cover bg-zinc-900" 
          onClick={() => onSetCurrent?.(image)}
        />
        <div className="absolute top-2 right-2 flex gap-1">
          <Button size="icon" variant="secondary" className="h-7 w-7 bg-black/60 hover:bg-black/80" onClick={handleDownload}>
            <Download className="w-3.5 h-3.5" />
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
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => onEdit(image)}>
                <Edit2 className="w-3 h-3 mr-1" /> 继续改
              </Button>
            )}
            {onRegen && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => onRegen(image)}>
                <RefreshCw className="w-3 h-3 mr-1" /> 重绘
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={copyPrompt}>
              <Copy className="w-3 h-3 mr-1" /> Prompt
            </Button>
            {onSetCurrent && (
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => onSetCurrent(image)}>
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
