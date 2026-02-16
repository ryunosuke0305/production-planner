import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type LoginViewProps = {
  loginId: string;
  loginPassword: string;
  loginError: string | null;
  authError: string | null;
  loginBusy: boolean;
  onLoginIdChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onLogin: () => void | Promise<void>;
};

export function LoginView({
  loginId,
  loginPassword,
  loginError,
  authError,
  loginBusy,
  onLoginIdChange,
  onLoginPasswordChange,
  onLogin,
}: LoginViewProps): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md rounded-2xl shadow-sm">
        <CardHeader className="space-y-2 pb-2">
          <CardTitle className="text-lg">ログイン</CardTitle>
          <div className="text-sm text-muted-foreground">ユーザーIDとパスワードを入力してアクセスしてください。</div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Input
            value={loginId}
            placeholder="ユーザーID"
            onChange={(event) => onLoginIdChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void onLogin();
              }
            }}
          />
          <Input
            type="password"
            value={loginPassword}
            placeholder="パスワード"
            onChange={(event) => onLoginPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void onLogin();
              }
            }}
          />
          {(loginError || authError) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {loginError || authError}
            </div>
          )}
          <Button className="w-full" onClick={() => void onLogin()} disabled={loginBusy || !loginId || !loginPassword}>
            {loginBusy ? "ログイン中..." : "ログイン"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
