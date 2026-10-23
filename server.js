const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// Rota de estado da API
app.get('/api/status', (req, res) => {
  res.json({ mensagem: 'A API do GatherTech está online e a escutar!' });
});

// ROTA POST: Autenticação de Utilizador (Login)
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;

  // Validação dos campos obrigatórios
  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
  }

  // Sanitização dos dados recebidos
  const emailTratado = email.toLowerCase().trim();
  const senhaTratada = senha.trim();

  try {
    console.log(`Tentativa de login para: [${emailTratado}]`);

    // Consulta case-insensitive para o e-mail
    const sql = `
      SELECT id_usuario, nome_usuario, email, tipo_usuario 
      FROM Usuarios 
      WHERE LOWER(TRIM(email)) = $1 AND senha = $2;
    `;
    const resultado = await db.query(sql, [emailTratado, senhaTratada]);

    if (resultado.rows.length === 0) {
      console.log('❌ Falha no login: E-mail ou senha incorretos.');
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const usuarioLogado = resultado.rows[0];
    console.log('✅ Login efetuado com sucesso:', usuarioLogado.email);

    res.json({
      mensagem: 'Login efetuado com sucesso!',
      usuario: usuarioLogado
    });
  } catch (err) {
    console.error('Erro ao efetuar login:', err);
    res.status(500).json({ erro: 'Erro ao validar login na base de dados' });
  }
});

// ROTA POST: Cadastro de Novo Utilizador
app.post('/api/cadastro', async (req, res) => {
  const { 
    nome_usuario, 
    email, 
    senha, 
    data_nascimento, 
    telefone, 
    cpf_cnpj,
    tipo_usuario = 'aluno' 
  } = req.body;

  // Validação: Verifica se todos os campos obrigatórios foram enviados
  if (!nome_usuario || !email || !senha || !data_nascimento || !telefone || !cpf_cnpj) {
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
  }

  // Sanitização antes de gravar na base de dados
  const emailTratado = email.toLowerCase().trim();
  const senhaTratada = senha.trim();

  try {
    // Verifica se o e-mail já existe (independente de maiúsculas/minúsculas)
    const verificarEmail = await db.query('SELECT email FROM Usuarios WHERE LOWER(TRIM(email)) = $1', [emailTratado]);
    if (verificarEmail.rows.length > 0) {
      return res.status(400).json({ erro: 'Este e-mail já está em uso por outra conta.' });
    }

    const verificarCpf = await db.query('SELECT cpf_cnpj FROM Usuarios WHERE cpf_cnpj = $1', [cpf_cnpj]);
    if (verificarCpf.rows.length > 0) {
      return res.status(400).json({ erro: 'Este CPF/CNPJ já se encontra registado.' });
    }

    // Insere o novo utilizador no PostgreSQL
    const sql = `
      INSERT INTO Usuarios (nome_usuario, email, senha, data_nascimento, telefone, cpf_cnpj, tipo_usuario)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id_usuario, nome_usuario, email, tipo_usuario;
    `;
    
    const valores = [nome_usuario.trim(), emailTratado, senhaTratada, data_nascimento, telefone, cpf_cnpj, tipo_usuario];
    const resultado = await db.query(sql, valores);

    console.log('✅ Novo utilizador cadastrado com sucesso:', emailTratado);

    res.status(201).json({
      mensagem: 'Conta criada com sucesso!',
      usuario: resultado.rows[0]
    });

  } catch (err) {
    console.error('Erro ao cadastrar utilizador:', err);
    res.status(500).json({ erro: 'Erro ao guardar o utilizador na base de dados.' });
  }
});

// ROTA GET: Lista todos os eventos cadastrados
app.get('/api/eventos', async (req, res) => {
  try {
    const resultado = await db.query('SELECT * FROM Eventos ORDER BY data_inicio ASC');
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao procurar eventos:', err);
    res.status(500).json({ erro: 'Erro ao procurar eventos na base de dados' });
  }
});

// ROTA POST: Cadastra um novo evento no PostgreSQL
app.post('/api/eventos', async (req, res) => {
  const {
    nome_evento,
    imagem,
    modalidade,
    data_inicio,
    horario_inicio,
    descricao_evento,
    data_fim,
    horario_fim,
    tipo_ingresso,
    nome_produtor,
    descricao_produtor,
    url_inscricao,
    id_tipo_evento = 1 
  } = req.body;

  try {
    const sql = `
      INSERT INTO Eventos (
        id_tipo_evento, nome_evento, imagem, modalidade, data_inicio, horario_inicio,
        descricao_evento, data_fim, horario_fim, tipo_ingresso, nome_produtor,
        descricao_produtor, url_inscricao, data_publicacao
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
      ) RETURNING *;
    `;

    const valores = [
      id_tipo_evento,
      nome_evento,
      imagem || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=600',
      modalidade || 'Presencial',
      data_inicio,
      horario_inicio,
      descricao_evento,
      data_fim,
      horario_fim,
      tipo_ingresso || 'Gratuito',
      nome_produtor,
      descricao_produtor,
      url_inscricao
    ];

    const resultado = await db.query(sql, valores);
    res.status(201).json({
      mensagem: 'Evento criado com sucesso!',
      evento: resultado.rows[0]
    });
  } catch (err) {
    console.error('Erro ao cadastrar evento:', err);
    res.status(500).json({ erro: 'Erro ao salvar o evento na base de dados' });
  }
});

const PORTA = 3000;
app.listen(PORTA, () => {
  console.log(`Servidor a rodar na porta ${PORTA}`);
});