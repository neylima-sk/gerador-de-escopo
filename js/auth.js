/* ==========================================================================
   auth.js — Login por código enviado no e-mail (Supabase Auth, sem senha),
   carregamento do catálogo após o login e cadastro de e-mails autorizados.

   Fluxo:
     1. Sem sessão → tela de login (e-mail → código).
     2. Com sessão → confere se o e-mail está autorizado, busca o catálogo
        (conteúdo do antigo js/data.js) no banco e só então carrega js/main.js.
   ========================================================================== */

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const auth = { email: '', admin: false, appCarregado: false };
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function $(id) { return document.getElementById(id); }

function escAuth(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Tela de login ---------- */
function mostrarLogin(etapa = 'email', msg = '', erro = false) {
    document.body.classList.add('nao-logado');
    $('login-etapa-email').hidden = etapa !== 'email';
    $('login-etapa-codigo').hidden = etapa !== 'codigo';
    $('login-etapa-catalogo').hidden = etapa !== 'catalogo';
    $('login-etapa-carregando').hidden = etapa !== 'carregando';
    const m = $('login-msg');
    m.textContent = msg;
    m.className = 'login-msg' + (erro ? ' erro' : '');
    if (etapa === 'email') $('login-email').focus();
    if (etapa === 'codigo') $('login-codigo').focus();
}

async function enviarCodigo(ev) {
    ev?.preventDefault();
    const email = $('login-email').value.trim().toLowerCase();
    if (!EMAIL_VALIDO.test(email)) return mostrarLogin('email', 'Informe um e-mail válido.', true);

    const btn = $('btn-enviar-codigo');
    btn.disabled = true; btn.textContent = 'Enviando...';
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    btn.disabled = false; btn.textContent = 'Enviar código';

    if (error) {
        console.warn('signInWithOtp:', error);
        const limite = error.status === 429 || /rate limit|seconds/i.test(error.message);
        return mostrarLogin('email', limite
            ? 'Muitas tentativas. Aguarde um minuto e tente de novo.'
            : 'Não foi possível enviar o código. Confira se o e-mail está cadastrado com o administrador.', true);
    }
    auth.email = email;
    $('login-email-enviado').textContent = email;
    $('login-codigo').value = '';
    mostrarLogin('codigo', 'Código enviado. Confira sua caixa de entrada (e o spam).');
}

async function validarCodigo(ev) {
    ev?.preventDefault();
    const token = $('login-codigo').value.replace(/\D/g, '');
    if (token.length < 6) return mostrarLogin('codigo', 'Digite o código recebido no e-mail.', true);

    const btn = $('btn-validar-codigo');
    btn.disabled = true; btn.textContent = 'Validando...';
    const { error } = await sb.auth.verifyOtp({ email: auth.email, token, type: 'email' });
    btn.disabled = false; btn.textContent = 'Entrar';

    if (error) return mostrarLogin('codigo', 'Código inválido ou expirado. Confira ou peça um novo.', true);
    await entrar();
}

function voltarParaEmail() { mostrarLogin('email'); }

async function sair() {
    if (auth.appCarregado && typeof haAlteracoes === 'function' && haAlteracoes()
        && !confirm('Há alterações não salvas nesta simulação. Sair mesmo assim?')) return;
    await sb.auth.signOut();
    location.reload();
}

/* ---------- Após o login ---------- */
async function entrar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrarLogin('email');
    mostrarLogin('carregando', 'Carregando...');

    auth.email = (session.user.email || '').toLowerCase();
    const { data: perfil, error: errPerfil } = await sb.from('emails_autorizados')
        .select('email, nome, admin').eq('email', auth.email).maybeSingle();

    if (errPerfil || !perfil) {
        await sb.auth.signOut();
        return mostrarLogin('email', 'Este e-mail não está autorizado. Fale com o administrador.', true);
    }
    auth.admin = perfil.admin;

    const { data: cat, error: errCat } = await sb.from('catalogo').select('codigo, versao, atualizado_em').eq('id', 1).maybeSingle();
    if (errCat) return mostrarLogin('email', 'Erro ao carregar o catálogo: ' + errCat.message, true);
    if (!cat) {
        if (auth.admin) return mostrarLogin('catalogo', 'O catálogo ainda não foi carregado. Envie o arquivo data.js para continuar.');
        await sb.auth.signOut();
        return mostrarLogin('email', 'O catálogo ainda não foi carregado pelo administrador.', true);
    }
    carregarApp(cat.codigo);
}

function carregarApp(codigoCatalogo) {
    if (auth.appCarregado) return;
    try {
        const s = document.createElement('script');
        s.textContent = codigoCatalogo;
        document.body.appendChild(s);       // executa o catálogo (antigo js/data.js)
    } catch (e) {
        return mostrarLogin('email', 'Catálogo com erro: ' + e.message, true);
    }
    const main = document.createElement('script');
    main.src = 'js/main.js';
    main.onload = () => {
        auth.appCarregado = true;
        document.body.classList.remove('nao-logado');
        $('usuario-email').textContent = auth.email;
        document.querySelectorAll('.so-admin').forEach(el => { el.hidden = !auth.admin; });
    };
    main.onerror = () => mostrarLogin('email', 'Não foi possível carregar a aplicação.', true);
    document.body.appendChild(main);
}

/* ---------- Catálogo (somente admin) ---------- */
async function enviarCatalogo(input, aposEnviar) {
    const arq = input.files?.[0];
    if (!arq) return;
    const codigo = await arq.text();
    input.value = '';
    if (!/const\s+catalogo\s*=/.test(codigo) || !/REGRA_HORAS/.test(codigo)) {
        return alert('O arquivo não parece ser o data.js do gerador (não encontrei "catalogo" e "REGRA_HORAS").');
    }
    try { new Function(codigo); } catch (e) { return alert('O arquivo tem erro de sintaxe: ' + e.message); }

    const { data: atual } = await sb.from('catalogo').select('versao').eq('id', 1).maybeSingle();
    const versao = (atual?.versao || 0) + 1;
    const { error } = await sb.from('catalogo')
        .upsert({ id: 1, codigo, versao, atualizado_em: new Date().toISOString() });
    if (error) return alert('Erro ao salvar o catálogo: ' + error.message);
    aposEnviar?.(versao);
}

function enviarCatalogoInicial(input) {
    enviarCatalogo(input, () => entrar());
}

function enviarCatalogoAdmin(input) {
    enviarCatalogo(input, versao => {
        toast(`Catálogo atualizado (versão ${versao}). Recarregue a página para usar os novos dados.`);
        renderizarUsuarios();
    });
}

/* ---------- Cadastro de e-mails (somente admin) ---------- */
async function renderizarUsuarios() {
    if (!auth.admin) return;
    const corpo = $('usuarios-lista');
    corpo.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';

    const [{ data, error }, { data: cat }] = await Promise.all([
        sb.from('emails_autorizados').select('*').order('email'),
        sb.from('catalogo').select('versao, atualizado_em').eq('id', 1).maybeSingle()
    ]);
    $('catalogo-info').textContent = cat
        ? `Versão ${cat.versao}, atualizada em ${new Date(cat.atualizado_em).toLocaleString('pt-BR')}`
        : 'Nenhum catálogo carregado.';

    if (error) { corpo.innerHTML = `<tr><td colspan="4">Erro: ${escAuth(error.message)}</td></tr>`; return; }
    corpo.innerHTML = data.map(u => `
        <tr>
            <td>${escAuth(u.email)}</td>
            <td>${escAuth(u.nome || '')}</td>
            <td class="center">
                <input type="checkbox" ${u.admin ? 'checked' : ''} ${u.email === auth.email ? 'disabled title="Você não pode remover seu próprio acesso de administrador"' : ''}
                       onchange="alterarAdmin('${escAuth(u.email)}', this.checked, this)">
            </td>
            <td class="center">
                ${u.email === auth.email ? '<small class="text-muted">você</small>'
                  : `<button class="btn btn-remove btn-sm" type="button" onclick="removerUsuario('${escAuth(u.email)}')">Remover</button>`}
            </td>
        </tr>`).join('') || '<tr><td colspan="4">Nenhum e-mail cadastrado.</td></tr>';
}

async function cadastrarUsuario(ev) {
    ev.preventDefault();
    const email = $('novo-email').value.trim().toLowerCase();
    const nome = $('novo-nome').value.trim();
    const admin = $('novo-admin').checked;
    if (!EMAIL_VALIDO.test(email)) return toast('Informe um e-mail válido.', true);

    const { error } = await sb.from('emails_autorizados').insert({ email, nome: nome || null, admin, criado_por: auth.email });
    if (error) return toast(error.code === '23505' ? 'Este e-mail já está cadastrado.' : 'Erro ao cadastrar: ' + error.message, true);

    ev.target.reset();
    toast(`${email} cadastrado. Ele já pode entrar com o código enviado por e-mail.`);
    renderizarUsuarios();
}

async function alterarAdmin(email, admin, chk) {
    const { error } = await sb.from('emails_autorizados').update({ admin }).eq('email', email);
    if (error) { chk.checked = !admin; return toast('Erro: ' + error.message, true); }
    toast(admin ? `${email} agora é administrador.` : `${email} deixou de ser administrador.`);
}

async function removerUsuario(email) {
    if (!confirm(`Remover o acesso de ${email}?`)) return;
    const { error } = await sb.from('emails_autorizados').delete().eq('email', email);
    if (error) return toast('Erro ao remover: ' + error.message, true);
    toast(`${email} removido.`);
    renderizarUsuarios();
}

/* ---------- Início ---------- */
sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' && auth.appCarregado) location.reload();
});
entrar();
