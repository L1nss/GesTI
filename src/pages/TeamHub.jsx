import { useCallback, useEffect, useMemo, useState } from "react";
import { Field, Icon } from "../shared.jsx";
import { hasSupabaseSession, restDelete, restInsert, restRpc, restSelect, restUpdate } from "../supabaseApi.js";
import { useToast } from "../toast.js";
import GuestMascot from "../GuestMascot.jsx";
import { keepWithinRetention } from "../retention.js";

const localKey = (companyId) => `gesti-team-v1-${companyId}`;
const stamp = (value) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dayKey = (value) => { const parts = new Intl.DateTimeFormat("pt-BR", { year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(value)).split("/"); return `${parts[2]}-${parts[1]}-${parts[0]}`; };

export default function TeamHub({ companyId, people, person, canManageCalendar, canCreateTeamChats = false }) {
  const toast = useToast();
  const [tab, setTab] = useState("chat");
  const [directory, setDirectory] = useState(people);
  const [partner, setPartner] = useState("");
  const [groupChats, setGroupChats] = useState([]);
  const [groupMessages, setGroupMessages] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [viewMonth, setViewMonth] = useState(() => { const now=new Date(); return new Date(now.getFullYear(),now.getMonth(),1); });
  const [selectedDate, setSelectedDate] = useState("");
  const [ready, setReady] = useState(false);
  const [notification, setNotification] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");

  const refresh = useCallback(async () => {
    if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(companyId)) {
      const [msgs, calendar, members, memberships, groupMsgs] = await Promise.all([
        restSelect("team_messages", `company_id=eq.${companyId}&order=created_at.asc&limit=500`),
        restSelect("team_events", `company_id=eq.${companyId}&order=starts_at.asc&limit=300`),
        restSelect("company_directory", `company_id=eq.${companyId}&order=display_name.asc`),
        restSelect("team_conversation_members", `company_id=eq.${companyId}&user_id=eq.${person.id}`),
        restSelect("team_group_messages", `company_id=eq.${companyId}&order=created_at.asc&limit=1000`),
      ]);
      const groupIds = memberships.map((membership) => membership.conversation_id);
      const groups = groupIds.length ? await restSelect("team_conversations", `company_id=eq.${companyId}&id=in.(${groupIds.join(",")})&order=created_at.desc`) : [];
      const team = members.map((member) => ({ id: member.user_id, name: member.display_name, role: member.role }));
      setMessages(msgs); setEvents(calendar); setDirectory(team); setGroupChats(groups); setGroupMessages(groupMsgs); setPartner((current) => team.some((member) => member.id === current) ? current : team.find((member) => member.id !== person.id)?.id || ""); setActiveGroupId((current) => groups.some((group) => group.id === current) ? current : ""); setReady(true); return;
    }
    setDirectory(people);
    setPartner((current) => people.some((member) => member.id === current) ? current : people.find((member) => member.id !== person.id)?.id || "");
    try {
      const saved = JSON.parse(localStorage.getItem(localKey(companyId)) || "{}");
      const retained = { messages: keepWithinRetention(saved.messages), events: keepWithinRetention(saved.events), groupChats: keepWithinRetention(saved.groupChats), groupMessages: keepWithinRetention(saved.groupMessages) };
      setMessages(retained.messages); setEvents(retained.events); setGroupChats(retained.groupChats); setGroupMessages(retained.groupMessages);
      localStorage.setItem(localKey(companyId), JSON.stringify(retained));
    } catch { setMessages([]); setEvents([]); setGroupChats([]); setGroupMessages([]); }
    setReady(true);
  }, [companyId, people, person.id]);
  useEffect(() => { let active = true; const safeRefresh = () => refresh().catch((error) => { if (active) toast({ tone: "info", title: "Equipe", message: error.message || "Não foi possível atualizar o chat." }); }); void safeRefresh(); const timer = window.setInterval(() => void safeRefresh(), 7000); return () => { active = false; window.clearInterval(timer); }; }, [refresh, toast]);

  const thread = useMemo(() => activeGroupId ? groupMessages.filter((message) => message.conversation_id === activeGroupId) : messages.filter((m) => (m.sender_user_id === person.id && m.recipient_user_id === partner) || (m.sender_user_id === partner && m.recipient_user_id === person.id)), [activeGroupId, groupMessages, messages, partner, person.id]);
  const activeGroup = groupChats.find((group) => group.id === activeGroupId);
  const monthCells = useMemo(() => { const first=new Date(viewMonth.getFullYear(),viewMonth.getMonth(),1); const offset=(first.getDay()+6)%7; return Array.from({length:42},(_,index)=>new Date(viewMonth.getFullYear(),viewMonth.getMonth(),index-offset+1)); }, [viewMonth]);
  const monthEvents = events.filter((event) => { const date=new Date(event.starts_at); return date.getFullYear()===viewMonth.getFullYear()&&date.getMonth()===viewMonth.getMonth()&&(!selectedDate||dayKey(event.starts_at)===selectedDate); });
  useEffect(() => { if (!partner || activeGroupId || !hasSupabaseSession()) return; const unread = thread.filter((m) => m.recipient_user_id === person.id && !m.read_at); if (unread.length) void Promise.all(unread.map((m) => restUpdate("team_messages", `id=eq.${m.id}`, { read_at: new Date().toISOString() }))).then(() => setMessages((list) => list.map((m) => unread.some((u) => u.id === m.id) ? { ...m, read_at: new Date().toISOString() } : m))).catch(() => {}); }, [activeGroupId, thread, person.id, partner]);

  const send = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("body") || "").trim();
    if (!body || (!activeGroupId && !partner)) return;
    try {
      if (activeGroupId) {
        if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(companyId)) {
          const [row] = await restInsert("team_group_messages", { company_id: companyId, conversation_id: activeGroupId, sender_user_id: person.id, body }); setGroupMessages((list) => [...list, row]);
        } else { const row = { id: crypto.randomUUID(), company_id: companyId, conversation_id: activeGroupId, sender_user_id: person.id, body, created_at: new Date().toISOString() }; const next = [...groupMessages, row]; setGroupMessages(next); localStorage.setItem(localKey(companyId), JSON.stringify({ messages, events, groupChats, groupMessages: next })); }
      } else if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(companyId)) {
        const [row] = await restInsert("team_messages", { company_id: companyId, sender_user_id: person.id, recipient_user_id: partner, body }); setMessages((list) => [...list, row]);
      } else { const row = { id: crypto.randomUUID(), company_id: companyId, sender_user_id: person.id, recipient_user_id: partner, body, created_at: new Date().toISOString() }; const next = [...messages, row]; setMessages(next); localStorage.setItem(localKey(companyId), JSON.stringify({ messages: next, events, groupChats, groupMessages })); }
      form.reset();
    } catch (error) { toast({ tone: "info", title: "Mensagem não enviada", message: error.message }); }
  };
  const createGroup = async (event) => {
    event.preventDefault();
    const title = newGroupTitle.trim();
    if (!canCreateTeamChats || title.length < 2 || selectedMemberIds.length < 1) return;
    setCreatingGroup(true);
    try {
      let groupId;
      if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(companyId)) {
        groupId = await restRpc("create_team_conversation", { p_company_id: companyId, p_title: title, p_member_ids: selectedMemberIds });
        await refresh();
      } else {
        groupId = crypto.randomUUID();
        const group = { id: groupId, company_id: companyId, title, created_by: person.id, created_at: new Date().toISOString(), participant_ids: [person.id, ...selectedMemberIds] };
        const nextGroups = [group, ...groupChats];
        setGroupChats(nextGroups);
        localStorage.setItem(localKey(companyId), JSON.stringify({ messages, events, groupChats: nextGroups, groupMessages }));
      }
      setActiveGroupId(groupId);
      setPartner("");
      setNewChatOpen(false);
      setMemberSearch("");
      setSelectedMemberIds([]);
      setNewGroupTitle("");
      toast({ tone: "success", title: "Conversa criada", message: `“${title}” está pronta para a equipe selecionada.` });
    } catch (error) {
      toast({ tone: "info", title: "Não foi possível criar a conversa", message: error.message || "Confira sua permissão e tente novamente." });
    } finally { setCreatingGroup(false); }
  };
  const openDirectChat = (memberId) => { setActiveGroupId(""); setPartner(memberId); setNewChatOpen(false); };
  const openGroupChat = (groupId) => { setPartner(""); setActiveGroupId(groupId); setNewChatOpen(false); };
  const saveEvent = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const start = new Date(String(data.get("starts_at"))); const end = new Date(String(data.get("ends_at")));
    if (end <= start) return toast({ tone: "info", title: "Horário inválido", message: "O término precisa ser depois do início." });
    const value = { company_id: companyId, created_by: person.id, title: String(data.get("title")).trim(), details: String(data.get("details") || "").trim(), starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: data.get("all_day") === "on", color: String(data.get("color") || "#2c666e") };
    try {
      if (hasSupabaseSession() && /^[0-9a-f-]{36}$/i.test(companyId)) { const [saved] = await restInsert("team_events", value); setEvents((items) => [...items, saved].sort((a,b)=>a.starts_at.localeCompare(b.starts_at))); }
      else { const saved = { ...value, id: crypto.randomUUID() }; const next = [...events, saved].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)); setEvents(next); localStorage.setItem(localKey(companyId), JSON.stringify({ messages, events: next, groupChats, groupMessages })); }
      form.reset(); toast({ tone: "success", title: "Evento adicionado", message: "A equipe já pode consultar o calendário." });
    } catch (error) { toast({ tone: "info", title: "Evento não salvo", message: error.message }); }
  };
  const removeEvent = async (id) => { try { if (hasSupabaseSession()) await restDelete("team_events", `id=eq.${id}`); const next=events.filter((item)=>item.id!==id); setEvents(next); if (!hasSupabaseSession()) localStorage.setItem(localKey(companyId),JSON.stringify({messages,events:next,groupChats,groupMessages})); } catch(error) { toast({tone:"info",title:"Não foi possível remover",message:error.message}); } };
  const enableNotifications = async () => { if (!("Notification" in window)) return toast({ tone: "info", title: "Notificações indisponíveis", message: "Este navegador não oferece notificações." }); const permission = await Notification.requestPermission(); setNotification(permission === "granted"); if (permission === "granted") new Notification("GesTI", { body: "Notificações ativadas neste dispositivo." }); else toast({ tone: "info", title: "Permissão não concedida", message: "Ative notificações nas configurações do navegador." }); };

  const calendarGrid = <div className="shared-calendar"><div className="shared-calendar-heading"><button aria-label="Mês anterior" className="icon-button" onClick={()=>{setViewMonth(new Date(viewMonth.getFullYear(),viewMonth.getMonth()-1,1));setSelectedDate("");}} type="button"><Icon name="chevron" size={15}/></button><strong>{viewMonth.toLocaleString("pt-BR",{month:"long",year:"numeric"})}</strong><button aria-label="Próximo mês" className="icon-button calendar-next" onClick={()=>{setViewMonth(new Date(viewMonth.getFullYear(),viewMonth.getMonth()+1,1));setSelectedDate("");}} type="button"><Icon name="chevron" size={15}/></button></div><div className="shared-calendar-grid"><div className="calendar-weekdays">{"seg ter qua qui sex sáb dom".split(" ").map((day)=><span key={day}>{day}</span>)}</div>{monthCells.map((date)=>{const key=dayKey(date);const dayEvents=events.filter((event)=>dayKey(event.starts_at)===key);const inMonth=date.getMonth()===viewMonth.getMonth();return <button aria-label={`${date.toLocaleDateString("pt-BR",{day:"numeric",month:"long"})}${dayEvents.length?`, ${dayEvents.length} evento(s)`:""}`} aria-pressed={selectedDate===key} className={`calendar-day ${inMonth?"":"outside-month"} ${selectedDate===key?"selected":""} ${dayEvents.length?"has-events":""}`} disabled={!inMonth} key={key} onClick={()=>setSelectedDate(selectedDate===key?"":key)} type="button"><span>{date.getDate()}</span>{dayEvents.length>0&&<i aria-hidden="true"/>}</button>;})}</div></div>;

  const searchableMembers = directory.filter((member) => member.id !== person.id && member.name.toLocaleLowerCase("pt-BR").includes(memberSearch.trim().toLocaleLowerCase("pt-BR")));
  return <div className="team-hub"><header className="team-hub-header"><div><span className="eyebrow">GES TI · ESPAÇO COMPARTILHADO</span><h2>Equipe</h2><p>Converse com colegas e acompanhe compromissos da empresa.</p></div><button className="button button-secondary" onClick={enableNotifications} type="button"><Icon name="bell" size={15}/>{notification ? "Alertas ativados" : "Ativar notificações"}</button></header>
    <nav aria-label="Recursos da equipe" className="team-tabs"><button aria-pressed={tab==="chat"} className={tab==="chat"?"team-tab active":"team-tab"} onClick={()=>setTab("chat")} type="button"><Icon name="chat" size={16}/>Chat</button><button aria-pressed={tab==="calendar"} className={tab==="calendar"?"team-tab active":"team-tab"} onClick={()=>setTab("calendar")} type="button"><Icon name="calendar" size={16}/>Calendário <span>{events.length}</span></button></nav>
    {tab==="chat" ? <section className="panel team-chat-panel"><aside className="team-chat-sidebar"><div className="team-chat-sidebar-heading"><h3>Conversas</h3>{canCreateTeamChats&&<button aria-expanded={newChatOpen} aria-label="Criar conversa em grupo" className="icon-button" onClick={()=>{setNewChatOpen((open)=>!open);setMemberSearch("");setSelectedMemberIds([]);}} title="Criar conversa em grupo" type="button"><Icon name="plus" size={16}/></button>}</div>
      {newChatOpen&&canCreateTeamChats&&<form className="team-new-chat" onSubmit={createGroup}><strong>Nova conversa em grupo</strong><Field label="Nome da conversa"><input maxLength={80} onChange={(event)=>setNewGroupTitle(event.target.value)} placeholder="Ex.: Projeto de infraestrutura" required value={newGroupTitle}/></Field><Field label="Buscar pessoas"><input autoComplete="off" onChange={(event)=>setMemberSearch(event.target.value)} placeholder="Digite o nome de alguém…" value={memberSearch}/></Field><div aria-label="Selecione os participantes" className="team-member-picker">{searchableMembers.length?searchableMembers.map((member)=><label className="team-member-option" key={member.id}><input checked={selectedMemberIds.includes(member.id)} onChange={(event)=>setSelectedMemberIds((current)=>event.target.checked?[...current,member.id]:current.filter((id)=>id!==member.id))} type="checkbox"/><span className="avatar small-avatar">{member.name.split(" ").map((part)=>part[0]).slice(0,2).join("")}</span><span><strong>{member.name}</strong><small>{member.role}</small></span></label>):<p>Nenhuma pessoa encontrada.</p>}</div><small>Você também será incluído automaticamente. {selectedMemberIds.length} colega(s) selecionado(s).</small><button className="button button-primary" disabled={creatingGroup||selectedMemberIds.length===0||newGroupTitle.trim().length<2} type="submit">{creatingGroup?"Criando…":"Criar conversa"}</button></form>}
      <h4 className="team-chat-section-label">Mensagens diretas</h4>{directory.filter((p)=>p.id!==person.id).map((p)=><button className={`team-contact ${!activeGroupId&&partner===p.id?"selected":""}`} key={p.id} onClick={()=>openDirectChat(p.id)} type="button"><span className="avatar small-avatar">{p.name.split(" ").map((x)=>x[0]).slice(0,2).join("")}</span><span><strong>{p.name}</strong><small>{p.role}</small></span></button>)}
      {groupChats.length>0&&<><h4 className="team-chat-section-label">Grupos</h4>{groupChats.map((group)=><button className={`team-contact ${activeGroupId===group.id?"selected":""}`} key={group.id} onClick={()=>openGroupChat(group.id)} type="button"><span className="team-group-icon"><Icon name="users" size={16}/></span><span><strong>{group.title}</strong><small>Conversa em grupo</small></span></button>)}</>}
    </aside><div className="team-chat-main">{partner||activeGroupId ? <><div className="team-chat-title"><strong>{activeGroupId?activeGroup?.title:directory.find((p)=>p.id===partner)?.name}</strong><small>{activeGroupId?"Conversa de grupo com participantes escolhidos":"Conversa privada entre colegas"}</small></div><div aria-live="polite" className="team-messages">{ready&&thread.length===0&&<div className="team-empty"><GuestMascot className="team-guest-mascot" paperLabel="OLÁ"/><span>Envie uma mensagem para iniciar a conversa.</span></div>}{thread.map((m)=><article className={`team-message ${m.sender_user_id===person.id?"mine":"theirs"}`} key={m.id}><p>{m.body}</p><time>{activeGroupId?(directory.find((member)=>member.id===m.sender_user_id)?.name||"Colega"):""}{activeGroupId?" · ":""}{stamp(m.created_at)}</time></article>)}</div><form className="team-composer" onSubmit={send}><textarea aria-label="Mensagem" maxLength="2000" name="body" placeholder="Escreva uma mensagem…" required rows="2"/><button aria-label="Enviar mensagem" className="button button-primary" type="submit"><Icon name="arrow" size={17}/></button></form></>:<p className="team-empty">Escolha uma conversa ou crie um grupo com colegas da equipe.</p>}</div></section> : <section className="team-calendar-layout"><section className="panel team-events-panel"><div className="panel-heading"><div><h3>Próximos eventos</h3><p>Agenda compartilhada da empresa</p></div><span className="panel-icon"><Icon name="calendar"/></span></div>{calendarGrid}{monthEvents.length ? <div className="team-event-list">{monthEvents.map((event)=><article className="team-event" key={event.id}><span className="team-event-marker" style={{background:event.color}}/><div><time>{stamp(event.starts_at)}{event.all_day?" · dia todo":""}</time><strong>{event.title}</strong>{event.details&&<p>{event.details}</p>}</div>{canManageCalendar&&<button aria-label={`Remover ${event.title}`} className="icon-button" onClick={()=>removeEvent(event.id)} type="button"><Icon name="close" size={15}/></button>}</article>)}</div>:<div className="team-empty"><GuestMascot className="team-guest-mascot" paperLabel="AGENDA"/><span>Seu calendário está pronto para receber eventos.</span></div>}</section>{canManageCalendar&&<section className="panel team-event-form"><h3>Novo evento</h3><form className="form-grid" onSubmit={saveEvent}><Field className="field-full" label="Nome do evento"><input maxLength="120" name="title" required/></Field><Field className="field-full" label="Detalhes"><textarea maxLength="1000" name="details" rows="3"/></Field><Field label="Início"><input name="starts_at" required type="datetime-local"/></Field><Field label="Término"><input name="ends_at" required type="datetime-local"/></Field><label className="checkbox-field"><input name="all_day" type="checkbox"/><span>Dia inteiro</span></label><Field label="Cor"><input defaultValue="#2c666e" name="color" type="color"/></Field><button className="button button-primary" type="submit"><Icon name="plus" size={15}/>Adicionar ao calendário</button></form></section>}</section>}
  </div>;
}
