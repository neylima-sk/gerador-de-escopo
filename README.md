# Gerador de Escopo e Sintonia — Sankhya

Ferramenta web (HTML, CSS e JavaScript puros, sem instalação) para montar o escopo de implantação,
calcular as horas pela regra do Ploomes e gerar os documentos em Word e HTML.

## Acesso (e-mail e senha)

O site fica no GitHub Pages e o login é feito com **e-mail e senha** (Supabase Auth, plano gratuito). A senha é
guardada criptografada (bcrypt) e cada login gera um **JWT**, validado pelo banco em toda consulta. Nenhum e-mail é enviado.

1. O administrador autoriza o e-mail na aba **Usuários**.
2. A pessoa abre o site, clica em **Primeiro acesso? Crie sua senha** e define a própria senha
   (mínimo 8 caracteres, com letras e números). O banco recusa e-mails que não foram autorizados.
3. Esqueceu a senha? O administrador clica em **Redefinir senha** e a pessoa cria outra em "Primeiro acesso".
4. Após **30 minutos sem uso** a sessão encerra; o sistema continua aberto por trás e basta entrar de novo.

O catálogo de packs e minutagem (`js/data.js`) **não vai para o GitHub**: fica na tabela `catalogo` do Supabase
e só é carregado depois do login. Para atualizar, edite o `data.js` no seu computador e envie o arquivo em
**Usuários → Catálogo de packs**. No primeiro acesso, o administrador envia o `data.js` na própria tela de login.

### Configuração única no painel do Supabase (projeto `gerador-de-escopo`)

1. **Authentication → Sign In / Providers → Email**: desligue **Confirm email** e salve
   (sem isso o Supabase tenta mandar e-mail de confirmação no cadastro).
2. Opcional, no mesmo lugar: **Minimum password length** = 8.

## Estrutura

```
gerador-de-escopo/
├── index.html             tela de login e da ferramenta
├── css/style.css          estilos
├── js/auth.js             login com senha, inatividade, carga do catálogo e cadastro de usuários
├── js/supabase-config.js  endereço e chave pública do Supabase
├── js/data.js             catálogo (só local, fora do Git; a versão em uso fica no Supabase)
├── js/main.js             lógica da tela, cálculo, exportações e versões
└── simulacoes/         versões salvas (uma subpasta por cliente e proposta; não vão para o Git)
```

## Como usar

Abra o `index.html` no Chrome ou no Edge. Para salvar versões, vá em **Simulações e Versões** e conecte a
pasta `gerador-sankhya`. Em outros navegadores a versão é baixada e deve ser movida para `simulacoes/`.

## Regra de horas

A mesma da aba "Simulador" da planilha *OM Ilimitado - Minutagem por Processo*:

1. Consultoria de pack: minutos dos subprocessos no escopo ÷ 60
2. Importação de dados: 20 h (+8 h no pacote adicional)
3. Matrizes, filiais e segmentos: (matrizes − 1) × 10% + filiais × 5% + (segmentos − 1) × 12,5% sobre o item 1, arredondado.
   Com escopo por CNPJ, cada CNPJ aplica o % do seu tipo só sobre as horas dos processos que usa.
4. Customização  5. Personalização  6. Integração com o ecossistema

Add-ons e layouts CNAB (5 h por banco de cobrança, 10 h por banco de pagamento) entram fora da regra.
Total desejado = arredondar para cima((1 a 6 + add-ons) × (1 + ajuste do EV) + horas adicionais do EV).

Os parâmetros ficam em `REGRA_HORAS`, no início do `js/data.js`.

## Atualizar a minutagem

Os minutos de cada subprocesso estão no campo `subprocessos` de cada pack, em `js/data.js`
(`[código do processo, subprocesso, minutos]`). Ao revisar a planilha, atualize os minutos ali.

## Rodar com Docker

Requer o Docker Desktop (Windows/macOS) ou o Docker Engine com o plugin Compose (Linux).

```
docker compose up -d
```

Abra `http://localhost:8080`. Para parar: `docker compose down`.

Os arquivos são montados direto da pasta do projeto: depois de editar o `data.js`, basta atualizar a página.
As simulações continuam sendo gravadas pelo navegador na pasta `simulacoes` do seu computador
(conecte a pasta `gerador-sankhya` na aba **Simulações e Versões**).
