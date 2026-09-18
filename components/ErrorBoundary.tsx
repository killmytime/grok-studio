'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    // In real app could report to monitoring
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex min-h-[200px] items-center justify-center p-8">
          <div className="rounded-lg border border-red-800 bg-red-950 p-6 text-center text-red-100">
            <h2 className="mb-2 text-lg font-medium">页面出错了</h2>
            <p className="text-sm opacity-80">请刷新页面重试，或联系支持。</p>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="mt-4 rounded bg-red-900 px-4 py-1 text-sm hover:bg-red-800"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
