import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportClientError, formatAiDiagnosticReport } from '../lib/selfHealingGuard';
import { ShieldCheck, RefreshCw, Copy, Check, AlertTriangle, Home, Terminal } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Automatically send to server & dispatch Telegram alert
    reportClientError(error, 'ReactErrorBoundary', {
      componentStack: errorInfo.componentStack || undefined,
    });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleHardReload = (): void => {
    try {
      // Clear transient temporary cache
      sessionStorage.clear();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  private handleCopyAiReport = async (): Promise<void> => {
    if (!this.state.error) return;

    const report = formatAiDiagnosticReport({
      error: this.state.error,
      source: 'ReactErrorBoundary',
      componentStack: this.state.errorInfo?.componentStack || undefined,
    });

    try {
      await navigator.clipboard.writeText(report);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 4000);
    } catch {
      // Fallback copy
      const textArea = document.createElement('textarea');
      textArea.value = report;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 4000);
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'অপ্রত্যাশিত কোনো ত্রুটি ঘটেছে';

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 selection:bg-emerald-500 selection:text-white">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header Badge */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  সেলফ-হিলিং গার্ড সক্রিয়
                </span>
                <h2 className="text-xl font-bold text-white mt-0.5">সিস্টেম রিকভারি মোড</h2>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-slate-300 mb-5 leading-relaxed">
              একটি অপ্রত্যাশিত কারিগরি সমস্যা ধরা পড়েছে, তবে <b className="text-emerald-400">আপনার একাউন্ট ব্যালেন্স ও ডেটা সম্পূর্ণ সুরক্ষিত</b> রয়েছে। আমাদের সার্ভার এবং অ্যাডমিন টেলিগ্রামে তাৎক্ষণিক অ্যালার্ট পাঠানো হয়েছে।
            </p>

            {/* Health pill indicators */}
            <div className="grid grid-cols-3 gap-2.5 mb-6 text-xs font-medium">
              <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-2.5 text-center">
                <span className="block text-emerald-400 font-bold mb-0.5">নিরাপদ</span>
                <span className="text-slate-400">ওয়ালেট ব্যালেন্স</span>
              </div>
              <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-2.5 text-center">
                <span className="block text-sky-400 font-bold mb-0.5">প্রেরিত</span>
                <span className="text-slate-400">টেলিগ্রাম অ্যালার্ট</span>
              </div>
              <div className="bg-slate-800/80 border border-slate-700/60 rounded-lg p-2.5 text-center">
                <span className="block text-amber-400 font-bold mb-0.5">সক্রিয়</span>
                <span className="text-slate-400">অটো-রিকভারি</span>
              </div>
            </div>

            {/* Error Message Box */}
            <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-3.5 mb-5 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-semibold text-rose-300 block mb-0.5">শনাক্তকৃত ত্রুটি:</span>
                <p className="text-rose-200/90 font-mono break-all line-clamp-3">{errorMessage}</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <button
                onClick={this.handleHardReload}
                className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/40 transition active:scale-[0.98]"
              >
                <RefreshCw className="w-4 h-4" />
                রিলোড ও ডাটা রিকভার করুন
              </button>

              <button
                onClick={this.handleCopyAiReport}
                className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition active:scale-[0.98]"
              >
                {this.state.copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">রিপোর্ট কপি হয়েছে!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-400" />
                    <span>কপি এআই ফিক্স রিপোর্ট</span>
                  </>
                )}
              </button>
            </div>

            {/* Secondary actions */}
            <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-slate-800">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white transition"
              >
                <Home className="w-3.5 h-3.5" />
                হোমপেজে ফিরে যান
              </button>

              <button
                onClick={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-emerald-400 transition"
              >
                <Terminal className="w-3.5 h-3.5" />
                {this.state.showDetails ? 'টেকনিক্যাল বিবরণ লুকান' : 'টেকনিক্যাল বিবরণ দেখুন'}
              </button>
            </div>

            {/* Technical details accordion */}
            {this.state.showDetails && (
              <div className="mt-4 p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto">
                <p className="text-amber-400 font-semibold mb-1">Stack Trace:</p>
                <pre className="whitespace-pre-wrap">{this.state.error?.stack || 'No stack'}</pre>
                {this.state.errorInfo?.componentStack && (
                  <>
                    <p className="text-sky-400 font-semibold mt-2 mb-1">Component Trace:</p>
                    <pre className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
