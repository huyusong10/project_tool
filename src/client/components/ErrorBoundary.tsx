import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

type ErrorBoundaryProps = { children: ReactNode; resetKey?: string };
type ErrorBoundaryState = { error: Error | null };

/** 渲染期异常兜底：避免整页白屏，路由切换（resetKey 变化）时自动复位。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page-content guest-landing">
        <div className="panel error-boundary-panel">
          <ShieldAlert size={32} />
          <h1>页面出现异常</h1>
          <p>{error.message || "渲染过程中发生未知错误。"}</p>
          <div className="error-boundary-actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>重新加载</button>
            <Link className="ghost-button" to="/">返回首页</Link>
          </div>
        </div>
      </div>
    );
  }
}
