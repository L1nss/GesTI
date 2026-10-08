import { useState } from "react";
import { Button, Field, Icon } from "../shared.jsx";

export default function FirstLoginPassword({ onSubmit, onLogout }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setBusy(true);
    try { await onSubmit(password); }
    catch (cause) { setError(cause.message || "Não foi possível salvar sua senha."); }
    finally { setBusy(false); }
  };
  return <main className="first-login-screen"><section className="panel first-login-card"><img alt="Gesti" className="brand-symbol brand-symbol-lg" src="/gesti-mark-primary.png" /><h1>Crie sua senha</h1><p>Este é seu primeiro acesso à equipe. Defina uma senha pessoal para continuar.</p><form className="auth-form" onSubmit={submit}><Field label="Nova senha"><input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password}/></Field><Field label="Confirmar senha"><input autoComplete="new-password" minLength={8} onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm}/></Field>{error && <p className="auth-error" role="alert"><Icon name="warning" size={14}/>{error}</p>}<Button className="auth-submit" disabled={busy} type="submit">{busy ? "Salvando senha…" : "Salvar e continuar"}</Button></form><button className="text-link" onClick={onLogout} type="button">Sair</button></section></main>;
}
