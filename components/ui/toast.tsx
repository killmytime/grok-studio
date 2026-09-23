'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { X } from 'lucide-react';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  toast: (props: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((props: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 11);
    const newToast: Toast = { variant: 'default', ...props, id, duration: props.duration ?? 5000 };

    setToasts((prev) => [...prev, newToast]);

    // Auto dismiss
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, newToast.duration);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex w-80 items-start gap-3 rounded-lg border p-4 shadow-lg ${
              t.variant === 'error'
                ? 'border-red-800 bg-red-950 text-red-100'
                : t.variant === 'success'
                ? 'border-green-800 bg-green-950 text-green-100'
                : t.variant === 'warning'
                ? 'border-yellow-800 bg-yellow-950 text-yellow-100'
                : 'border-zinc-700 bg-zinc-900 text-zinc-100'
            }`}
          >
            <div className="flex-1">
              <div className="font-medium">{t.title}</div>
              {t.description && (
                <div className="mt-1 text-sm opacity-90">{t.description}</div>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="mt-0.5 opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Convenience helper (can be called from anywhere after provider is mounted)
export const toast = {
  success: (title: string, description?: string) =>
    // This will only work after provider mounts; in practice we use the hook in components
    console.warn('Use useToast() hook inside components'),
  error: (title: string, description?: string) => console.warn('Use useToast() hook'),
};
