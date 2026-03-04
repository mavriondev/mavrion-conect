import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Plus, Pencil, Trash2, Loader2, ShieldCheck, Shield, User, Mail, Search, X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface UserRecord {
  id: number;
  username: string;
  role: string;
  permissions: Record<string, boolean>;
  orgId: number | null;
  email?: string;
  emailSignature?: string;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MODULES: { key: string; label: string }[] = [
  { key: "dashboard",   label: "Dashboard" },
  { key: "prospeccao",  label: "Prospecção" },
  { key: "empresas",    label: "Empresas" },
  { key: "sdr",         label: "SDR Queue" },
  { key: "crm",         label: "Deals & CRM" },
  { key: "matching",    label: "Matching" },
  { key: "connectors",  label: "Connectors" },
  { key: "users",       label: "Usuários (admin)" },
];

const ROLE_DEFAULTS: Record<string, Record<string, boolean>> = {
  admin:   { dashboard: true, prospeccao: true, empresas: true, sdr: true, crm: true, matching: true, connectors: true, users: true },
  manager: { dashboard: true, prospeccao: true, empresas: true, sdr: true, crm: true, matching: true, connectors: false, users: false },
  sdr:     { dashboard: true, prospeccao: true, empresas: true, sdr: true, crm: false, matching: false, connectors: false, users: false },
};

const ROLE_ICON: Record<string, any> = {
  admin: ShieldCheck,
  manager: Shield,
  sdr: User,
};

const ROLE_COLOR: Record<string, string> = {
  admin: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  sdr: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

// ── Permission Editor ─────────────────────────────────────────────────────────
function PermissionEditor({
  role,
  permissions,
  onChange,
}: {
  role: string;
  permissions: Record<string, boolean>;
  onChange: (p: Record<string, boolean>) => void;
}) {
  const effective = Object.keys(permissions).length > 0 ? permissions : ROLE_DEFAULTS[role] || ROLE_DEFAULTS.sdr;

  const toggle = (key: string) => {
    onChange({ ...effective, [key]: !effective[key] });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Permissões por Módulo</Label>
      <div className="grid grid-cols-2 gap-2">
        {MODULES.map(m => (
          <div key={m.key} className="flex items-center justify-between gap-2 p-2 rounded-lg border bg-muted/30">
            <Label htmlFor={`perm-${m.key}`} className="text-sm font-normal cursor-pointer">{m.label}</Label>
            <Switch
              id={`perm-${m.key}`}
              checked={effective[m.key] ?? false}
              onCheckedChange={() => toggle(m.key)}
              data-testid={`switch-perm-${m.key}`}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Ao personalizar permissões, o perfil de cargo é sobrescrito.{" "}
        <button className="underline" onClick={() => onChange({})}>Redefinir para padrão do cargo</button>
      </p>
    </div>
  );
}

// ── User Dialog ───────────────────────────────────────────────────────────────
function UserDialog({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user?: UserRecord | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!user;

  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role || "sdr");
  const [permissions, setPermissions] = useState<Record<string, boolean>>(
    user?.permissions && Object.keys(user.permissions).length > 0 ? user.permissions : {}
  );
  const [email, setEmail] = useState(user?.email || "");
  const [emailSignature, setEmailSignature] = useState(user?.emailSignature || "");

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const body: any = { role, permissions, email: email || null, emailSignature: emailSignature || null };
        if (password) body.password = password;
        return apiRequest("PATCH", `/api/admin/users/${user!.id}`, body);
      } else {
        return apiRequest("POST", "/api/admin/users", { username, password, role, permissions });
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Usuário atualizado!" : "Usuário criado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Erro ao salvar usuário", variant: "destructive" });
    },
  });

  const handleRoleChange = (newRole: string) => {
    setRole(newRole);
    if (Object.keys(permissions).length === 0) {
      // If using defaults, keep using defaults (empty means role-based)
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar — ${user!.username}` : "Novo Usuário"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="username">Usuário</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="nome.sobrenome"
                data-testid="input-username"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password">{isEdit ? "Nova Senha (deixe em branco para manter)" : "Senha"}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isEdit ? "••••••••" : "Mínimo 6 caracteres"}
              data-testid="input-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cargo</Label>
            <Select value={role} onValueChange={handleRoleChange}>
              <SelectTrigger data-testid="select-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="sdr">SDR</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <PermissionEditor role={role} permissions={permissions} onChange={setPermissions} />

          {isEdit && (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Mail className="w-4 h-4" />
                Configurações de Email
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-email">Email remetente (Reply-To)</Label>
                <Input
                  id="user-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@empresa.com.br"
                  data-testid="input-user-email"
                />
                <p className="text-xs text-muted-foreground">Quando enviar propostas por email, o destinatário poderá responder diretamente para este endereço.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-signature">Assinatura de email</Label>
                <Textarea
                  id="user-signature"
                  value={emailSignature}
                  onChange={e => setEmailSignature(e.target.value)}
                  placeholder="Nome Sobrenome&#10;Cargo | Empresa&#10;(11) 99999-9999"
                  rows={4}
                  data-testid="textarea-email-signature"
                />
                <p className="text-xs text-muted-foreground">Suporta HTML básico: {"<b>"}, {"<i>"}, {"<br>"}. Aparecerá ao final de todo email enviado por este usuário.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || (!isEdit && !username) || (!isEdit && !password)}
            data-testid="button-salvar-usuario"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {isEdit ? "Salvar alterações" : "Criar usuário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserRecord | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");

  const { data: users, isLoading } = useQuery<UserRecord[]>({
    queryKey: ["/api/admin/users"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      toast({ title: "Usuário removido" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeletingUser(null);
    },
    onError: () => toast({ title: "Erro ao remover usuário", variant: "destructive" }),
  });

  const openCreate = () => { setEditingUser(null); setDialogOpen(true); };
  const openEdit = (u: UserRecord) => { setEditingUser(u); setDialogOpen(true); };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie os usuários do sistema e suas permissões por módulo.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 self-start sm:self-auto" data-testid="button-novo-usuario">
          <Plus className="w-4 h-4" /> Novo Usuário
        </Button>
      </div>

      {/* Module legend */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm font-medium mb-2">Permissões padrão por cargo:</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div>
              <p className="font-semibold text-violet-600 mb-1">Admin</p>
              <p>Acesso completo a todos os módulos.</p>
            </div>
            <div>
              <p className="font-semibold text-blue-600 mb-1">Manager</p>
              <p>Acesso a tudo exceto Connectors e Usuários.</p>
            </div>
            <div>
              <p className="font-semibold text-gray-600 mb-1">SDR</p>
              <p>Dashboard, Prospecção, Empresas e SDR Queue apenas.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar usuário..."
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            className="pl-8 h-8 text-sm w-44"
            data-testid="input-user-search"
          />
        </div>
        <Select value={userRoleFilter} onValueChange={setUserRoleFilter}>
          <SelectTrigger className="h-8 text-sm w-32" data-testid="select-user-role">
            <SelectValue placeholder="Cargo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos cargos</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="sdr">SDR</SelectItem>
          </SelectContent>
        </Select>
        {(userSearch || userRoleFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setUserSearch(""); setUserRoleFilter("all"); }}
            className="h-8 px-2 text-xs text-muted-foreground"
            data-testid="button-clear-user-filters"
          >
            <X className="w-3.5 h-3.5 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* User list */}
      {!isLoading && (
        <div className="space-y-3">
          {(users || []).filter(u => {
            if (userSearch.trim()) {
              const q = userSearch.toLowerCase();
              if (!u.username.toLowerCase().includes(q) && !(u.email || "").toLowerCase().includes(q)) return false;
            }
            if (userRoleFilter !== "all" && u.role !== userRoleFilter) return false;
            return true;
          }).map(u => {
            const RoleIcon = ROLE_ICON[u.role] || User;
            const hasCustomPerms = u.permissions && Object.keys(u.permissions).length > 0;
            const effectivePerms = hasCustomPerms ? u.permissions : (ROLE_DEFAULTS[u.role] || ROLE_DEFAULTS.sdr);
            const enabledModules = MODULES.filter(m => effectivePerms[m.key]);

            return (
              <Card key={u.id} data-testid={`card-usuario-${u.id}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-2 rounded-lg ${ROLE_COLOR[u.role] || ROLE_COLOR.sdr}`}>
                        <RoleIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{u.username}</p>
                          <Badge variant="outline" className={`text-xs ${ROLE_COLOR[u.role]}`}>
                            {u.role}
                          </Badge>
                          {hasCustomPerms && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              Permissões customizadas
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {enabledModules.map(m => (
                            <span key={m.key} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {m.label}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Criado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(u)}
                        className="gap-1.5"
                        data-testid={`button-editar-usuario-${u.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" /> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeletingUser(u)}
                        className="gap-1.5 text-destructive hover:text-destructive"
                        data-testid={`button-remover-usuario-${u.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {users?.length === 0 && (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <Users className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Nenhum usuário encontrado.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create/Edit Dialog */}
      {dialogOpen && (
        <UserDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditingUser(null); }}
          user={editingUser}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingUser} onOpenChange={o => !o && setDeletingUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover <strong>{deletingUser?.username}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingUser && deleteMutation.mutate(deletingUser.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirmar-remover"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
