import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] 未処理のエラーが発生しました:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <p className="text-red-600 font-semibold mb-2">予期しないエラーが発生しました</p>
          <p className="text-gray-500 text-sm mb-4 max-w-md break-all">
            {this.state.error?.message ?? "不明なエラー"}
          </p>
          <button
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={this.handleReset}
          >
            再試行
          </button>
          <button
            className="mt-2 px-4 py-2 text-sm text-gray-600 underline"
            onClick={() => window.location.reload()}
          >
            ページを再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
