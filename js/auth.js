/* ==========================================================================
   auth.js — Login com e-mail e senha (Supabase Auth: senha com bcrypt,
   sessão validada por JWT), carga do catálogo após o login, encerramento
   por inatividade e cadastro de e-mails autorizados.

   Fluxo:
     1. O admin autoriza o e-mail na aba Usuários.
     2. A pessoa clica em "Primeiro acesso" e cria a própria senha
        (o banco recusa e-mails que não estão autorizados).
     3. Com sessão válida → confere a autorização, busca o catálogo
        (conteúdo do antigo js/data.js) e só então carrega js/main.js.
     4. Após 30 min sem uso a sessão é encerrada.
   ========================================================================== */

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const auth = { email: '', admin: false, appCarregado: false, emailDaSessao: '' };
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LIMITE_INATIVIDADE_MS = 30 * 60 * 1000;   // encerra a sessão após 30 min sem uso
const AVISO_ANTES_MS = 2 * 60 * 1000;           // avisa 2 min antes
const CHAVE_ATIVIDADE = 'gerador-escopo-ultima-atividade';

function $(id) { return document.getElementById(id); }

function escAuth(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Tela de login ---------- */
function mostrarLogin(etapa = 'entrar', msg = '', erro = false) {
    document.body.classList.add('nao-logado');
    ['entrar', 'criar', 'catalogo', 'carregando'].forEach(e => { $('login-etapa-' + e).hidden = etapa !== e; });
    const m = $('login-msg');
    m.textContent = msg;
    m.className = 'login-msg' + (erro ? ' erro' : '');
    if (etapa === 'entrar') ($('login-email').value ? $('login-senha') : $('login-email')).focus();
    if (etapa === 'criar') $('criar-email').focus();
}

function alternarModoLogin(modo) {
    if (modo === 'criar' && !$('criar-email').value) $('criar-email').value = $('login-email').value;
    if (modo === 'entrar' && !$('login-email').value) $('login-email').value = $('criar-email').value;
    mostrarLogin(modo);
}

function mostrarSenha(botao) {
    const campo = botao.previousElementSibling;
    const visivel = campo.type === 'text';
    campo.type = visivel ? 'password' : 'text';
    botao.textContent = visivel ? 'Mostrar' : 'Ocultar';
}

function ocupado(id, texto) {
    const btn = $(id);
    btn.disabled = !!texto;
    if (texto) { btn.dataset.texto = btn.textContent; btn.textContent = texto; }
    else if (btn.dataset.texto) btn.textContent = btn.dataset.texto;
}

async function entrarComSenha(ev) {
    ev.preventDefault();
    const email = $('login-email').value.trim().toLowerCase();
    const password = $('login-senha').value;
    if (!EMAIL_VALIDO.test(email)) return mostrarLogin('entrar', 'Informe um e-mail válido.', true);

    ocupado('btn-entrar', 'Entrando...');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    ocupado('btn-entrar');

    if (error) {
        console.warn('signInWithPassword:', error);
        $('login-senha').value = '';
        const limite = error.status === 429;
        return mostrarLogin('entrar', limite
            ? 'Muitas tentativas. Aguarde um pouco e tente de novo.'
            : 'E-mail ou senha incorretos. Se ainda não criou sua senha, use "Primeiro acesso".', true);
    }
    $('login-senha').value = '';
    registrarAtividade(true);
    await entrar();
}

function senhaForte(senha) {
    return senha.length >= 8 && /[A-Za-zÀ-ÿ]/.test(senha) && /\d/.test(senha);
}

async function criarAcesso(ev) {
    ev.preventDefault();
    const email = $('criar-email').value.trim().toLowerCase();
    const senha = $('criar-senha').value;
    if (!EMAIL_VALIDO.test(email)) return mostrarLogin('criar', 'Informe um e-mail válido.', true);
    if (!senhaForte(senha)) return mostrarLogin('criar', 'A senha precisa ter no mínimo 8 caracteres, com letras e números.', true);
    if (senha !== $('criar-senha2').value) return mostrarLogin('criar', 'As senhas não conferem.', true);

    ocupado('btn-criar', 'Criando...');
    const { data, error } = await sb.auth.signUp({ email, password: senha });
    ocupado('btn-criar');

    if (error) {
        console.warn('signUp:', error);
        let msg = 'Não foi possível criar o acesso. Tente de novo em instantes.';
        if (/already registered|already exists/i.test(error.message))
            msg = 'Este e-mail já tem senha. Use "Já tenho senha" ou peça ao administrador para redefinir.';
        else if (/database error|saving new user|NAO_AUTORIZADO/i.test(error.message))
            msg = 'Este e-mail não está autorizado. Peça ao administrador para cadastrá-lo.';
        else if (/confirmation email|sending/i.test(error.message))
            msg = 'O sistema ainda exige confirmação por e-mail. Avise o administrador (Supabase: desligar "Confirm email").';
        else if (/password/i.test(error.message))
            msg = 'Senha recusada: ' + error.message;
        return mostrarLogin('criar', msg, true);
    }

    $('criar-senha').value = $('criar-senha2').value = '';
    // Sem sessão: o e-mail já existia (o Supabase não revela isso) ou a confirmação por e-mail está ligada
    if (!data.session) {
        $('login-email').value = email;
        return mostrarLogin('entrar', 'Se este e-mail já tinha senha, use "Entrar". Se o problema continuar, fale com o administrador.', true);
    }
    registrarAtividade(true);
    await entrar();
}

async function sair() {
    if (auth.appCarregado && typeof haAlteracoes === 'function' && haAlteracoes()
        && !confirm('Há alterações não salvas nesta simulação. Sair mesmo assim?')) return;
    pararInatividade();
    await sb.auth.signOut();
    location.reload();
}

/* ---------- Após o login ---------- */
async function entrar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrarLogin('entrar');

    // Sessão antiga parada há mais de 30 min (ex.: navegador reaberto): encerra
    if (Date.now() - ultimaAtividade() > LIMITE_INATIVIDADE_MS && !auth.emailDaSessao && !auth.appCarregado) {
        const recemLogado = Date.now() - new Date(session.user.last_sign_in_at || 0).getTime() < 60 * 1000;
        if (!recemLogado) {
            await sb.auth.signOut();
            return mostrarLogin('entrar', 'Sua sessão expirou por inatividade. Entre novamente.');
        }
    }

    auth.email = (session.user.email || '').toLowerCase();

    // Retomando após expirar por inatividade, com o app já aberto
    if (auth.appCarregado) {
        if (auth.email !== auth.emailDaSessao) { location.reload(); return; }
        document.body.classList.remove('nao-logado');
        iniciarInatividade();
        return;
    }

    mostrarLogin('carregando', 'Carregando...');
    const { data: perfil, error: errPerfil } = await sb.from('emails_autorizados')
        .select('email, nome, admin').eq('email', auth.email).maybeSingle();

    if (errPerfil || !perfil) {
        await sb.auth.signOut();
        return mostrarLogin('entrar', 'Este e-mail não está mais autorizado. Fale com o administrador.', true);
    }
    auth.admin = perfil.admin;

    const { data: cat, error: errCat } = await sb.from('catalogo').select('codigo, versao, atualizado_em').eq('id', 1).maybeSingle();
    if (errCat) return mostrarLogin('entrar', 'Erro ao carregar o catálogo: ' + errCat.message, true);
    if (!cat) {
        if (auth.admin) return mostrarLogin('catalogo', 'O catálogo ainda não foi carregado. Envie o arquivo data.js para continuar.');
        await sb.auth.signOut();
        return mostrarLogin('entrar', 'O catálogo ainda não foi carregado pelo administrador.', true);
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
        return mostrarLogin('entrar', 'Catálogo com erro: ' + e.message, true);
    }
    const main = document.createElement('script');
    main.src = 'js/main.js';
    main.onload = () => {
        auth.appCarregado = true;
        auth.emailDaSessao = auth.email;
        document.body.classList.remove('nao-logado');
        $('usuario-email').textContent = auth.email;
        document.querySelectorAll('.so-admin').forEach(el => { el.hidden = !auth.admin; });
        iniciarInatividade();
    };
    main.onerror = () => mostrarLogin('entrar', 'Não foi possível carregar a aplicação.', true);
    document.body.appendChild(main);
}

/* ---------- Encerramento por inatividade (30 min) ---------- */
let timerInatividade = null;
let ultimoRegistro = 0;

function ultimaAtividade() {
    try { return Number(localStorage.getItem(CHAVE_ATIVIDADE)) || 0; } catch { return ultimoRegistro; }
}

function registrarAtividade(forcar = false) {
    const agora = Date.now();
    if (!forcar && agora - ultimoRegistro < 5000) return;   // grava no máximo a cada 5 s
    if (!forcar && $('modal-inatividade').classList.contains('aberto')) return; // só o botão confirma
    ultimoRegistro = agora;
    try { localStorage.setItem(CHAVE_ATIVIDADE, String(agora)); } catch { /* sem storage: vale só esta aba */ }
    $('modal-inatividade').classList.remove('aberto');
}

const EVENTOS_ATIVIDADE = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
const aoAgir = () => registrarAtividade();

function iniciarInatividade() {
    registrarAtividade(true);
    EVENTOS_ATIVIDADE.forEach(ev => window.addEventListener(ev, aoAgir, { passive: true }));
    clearInterval(timerInatividade);
    timerInatividade = setInterval(verificarInatividade, 1000);
}

function pararInatividade() {
    clearInterval(timerInatividade);
    EVENTOS_ATIVIDADE.forEach(ev => window.removeEventListener(ev, aoAgir));
    $('modal-inatividade').classList.remove('aberto');
}

async function verificarInatividade() {
    const parado = Date.now() - Math.max(ultimaAtividade(), ultimoRegistro);
    const restante = LIMITE_INATIVIDADE_MS - parado;
    if (restante <= 0) {
        pararInatividade();
        await sb.auth.signOut();
        // Mantém o sistema aberto por trás (simulação não salva não se perde)
        $('login-email').value = auth.emailDaSessao;
        mostrarLogin('entrar', 'Sessão encerrada após 30 minutos sem uso. Entre novamente para continuar.');
        return;
    }
    const modal = $('modal-inatividade');
    if (restante <= AVISO_ANTES_MS) {
        $('inatividade-segundos').textContent = Math.ceil(restante / 1000);
        modal.classList.add('aberto');
    } else {
        modal.classList.remove('aberto');   // outra aba registrou atividade
    }
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
    enviarCatalogo(input, () => { registrarAtividade(true); entrar(); });
}

function enviarCatalogoAdmin(input) {
    enviarCatalogo(input, versao => {
        toast(`Catálogo atualizado (versão ${versao}). Recarregue a página para usar os novos dados.`);
        renderizarUsuarios();
    });
}

/* ---------- Cadastro de e-mails (somente admin) ---------- */
function dataHora(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

async function renderizarUsuarios() {
    if (!auth.admin) return;
    const corpo = $('usuarios-lista');
    corpo.innerHTML = '<tr><td colspan="5">Carregando...</td></tr>';

    const [{ data, error }, { data: cat }] = await Promise.all([
        sb.rpc('admin_listar_usuarios'),
        sb.from('catalogo').select('versao, atualizado_em').eq('id', 1).maybeSingle()
    ]);
    $('catalogo-info').textContent = cat
        ? `Versão ${cat.versao}, atualizada em ${dataHora(cat.atualizado_em)}`
        : 'Nenhum catálogo carregado.';

    if (error) { corpo.innerHTML = `<tr><td colspan="5">Erro: ${escAuth(error.message)}</td></tr>`; return; }
    corpo.innerHTML = data.map(u => {
        const eu = u.email === auth.email;
        const e = escAuth(u.email);
        const acesso = u.tem_acesso
            ? `<span class="selo-acesso ok">Senha criada</span>${u.ultimo_login ? `<br><small class="text-muted">último acesso ${dataHora(u.ultimo_login)}</small>` : ''}`
            : '<span class="selo-acesso">Aguardando cadastro</span>';
        return `
        <tr>
            <td>${e}</td>
            <td>${escAuth(u.nome || '')}</td>
            <td>${acesso}</td>
            <td class="center">
                <input type="checkbox" ${u.admin ? 'checked' : ''} ${eu ? 'disabled title="Você não pode remover seu próprio acesso de administrador"' : ''}
                       onchange="alterarAdmin('${e}', this.checked, this)">
            </td>
            <td class="center acoes-usuario">
                ${eu ? '<small class="text-muted">você</small>' : `
                    ${u.tem_acesso ? `<button class="btn btn-sec btn-sm" type="button" onclick="redefinirAcesso('${e}')">Redefinir senha</button>` : ''}
                    <button class="btn btn-remove btn-sm" type="button" onclick="removerUsuario('${e}')">Remover</button>`}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5">Nenhum e-mail cadastrado.</td></tr>';
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
    toast(`${email} autorizado. Peça para abrir o site e clicar em "Primeiro acesso".`);
    renderizarUsuarios();
}

async function alterarAdmin(email, admin, chk) {
    const { error } = await sb.from('emails_autorizados').update({ admin }).eq('email', email);
    if (error) { chk.checked = !admin; return toast('Erro: ' + error.message, true); }
    toast(admin ? `${email} agora é administrador.` : `${email} deixou de ser administrador.`);
}

async function redefinirAcesso(email) {
    if (!confirm(`Apagar a senha de ${email}?\n\nA pessoa sai de qualquer sessão aberta e precisa criar uma nova senha em "Primeiro acesso".`)) return;
    const { error } = await sb.rpc('admin_redefinir_acesso', { p_email: email });
    if (error) return toast('Erro ao redefinir: ' + error.message, true);
    toast(`Senha de ${email} apagada. Ela já pode criar uma nova em "Primeiro acesso".`);
    renderizarUsuarios();
}

async function removerUsuario(email) {
    if (!confirm(`Remover o acesso de ${email}?`)) return;
    const { error: errAcesso } = await sb.rpc('admin_redefinir_acesso', { p_email: email });  // apaga a senha também
    if (errAcesso) return toast('Erro ao remover: ' + errAcesso.message, true);
    const { error } = await sb.from('emails_autorizados').delete().eq('email', email);
    if (error) return toast('Erro ao remover: ' + error.message, true);
    toast(`${email} removido.`);
    renderizarUsuarios();
}

/* ---------- Início ---------- */
entrar();
