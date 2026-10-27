const express = require('express');
const cors = require('cors');
const db = require('./db');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

const app = express();

app.use(cors());
app.use(express.json());

const googleClient = new OAuth2Client();

// CONFIGURAÇÃO DO NODEMAILER
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'engtailon@gmail.com',
    pass: 'anqkvsziwmmdsplo'
  },
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 5000
});

transporter.verify((error) => {
  if (error) {
    console.error('❌ Erro na configuração do e-mail (SMTP):', error.message);
  } else {
    console.log('✅ Servidor de e-mail pronto para enviar mensagens!');
  }
});

// Rota de Status da API
app.get('/api/status', (req, res) => {
  res.json({ mensagem: 'A API do GatherTech está online e a escutar!' });
});

// ==========================================
// ROTAS DE AUTENTICAÇÃO E USUÁRIOS
// ==========================================

// ROTA POST: Login com Google
app.post('/api/auth/google', async (req, res) => {
  const { email, name, googleId } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'O e-mail do Google é obrigatório.' });
  }

  try {
    const emailTratado = email.toLowerCase().trim();

    let resultado = await db.query(
      'SELECT id_usuario, nome_usuario, email, tipo_usuario FROM Usuarios WHERE LOWER(TRIM(email)) = $1',
      [emailTratado]
    );

    let usuarioLogado;

    if (resultado.rows.length === 0) {
      const novoUsuario = await db.query(
        `INSERT INTO Usuarios (nome_usuario, email, senha, data_nascimento, telefone, cpf_cnpj, tipo_usuario)
         VALUES ($1, $2, $3, NOW(), 'Google', $4, 'aluno')
         RETURNING id_usuario, nome_usuario, email, tipo_usuario`,
        [name || 'Usuário Google', emailTratado, 'AUTH_SOCIAL_GOOGLE', googleId || 'GOOGLE_USER']
      );
      usuarioLogado = novoUsuario.rows[0];
      console.log(`✅ Novo cadastro via Google realizado: ${emailTratado}`);
    } else {
      usuarioLogado = resultado.rows[0];
      console.log(`✅ Login via Google efetuado com sucesso: ${emailTratado}`);
    }

    return res.json({
      mensagem: 'Autenticado com sucesso via Google!',
      usuario: usuarioLogado
    });

  } catch (err) {
    console.error('❌ Erro no login social Google:', err);
    return res.status(500).json({ erro: 'Erro interno ao autenticar com o Google.' });
  }
});

// ROTA POST: Login Tradicional
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
  }

  const emailTratado = email.toLowerCase().trim();

  try {
    const sql = `
      SELECT id_usuario, nome_usuario, email, tipo_usuario 
      FROM Usuarios 
      WHERE LOWER(TRIM(email)) = $1 AND senha = $2;
    `;
    const resultado = await db.query(sql, [emailTratado, senha.trim()]);

    if (resultado.rows.length === 0) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    res.json({
      mensagem: 'Login efetuado com sucesso!',
      usuario: resultado.rows[0]
    });
  } catch (err) {
    console.error('Erro ao efetuar login:', err);
    res.status(500).json({ erro: 'Erro ao validar login na base de dados.' });
  }
});

// ROTA POST: Cadastro de Usuário
app.post('/api/cadastro', async (req, res) => {
  const { 
    nome_usuario, email, senha, data_nascimento, telefone, cpf_cnpj, tipo_usuario = 'aluno' 
  } = req.body;

  if (!nome_usuario || !email || !senha || !data_nascimento || !telefone || !cpf_cnpj) {
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
  }

  const emailTratado = email.toLowerCase().trim();

  try {
    const verificarEmail = await db.query('SELECT email FROM Usuarios WHERE LOWER(TRIM(email)) = $1', [emailTratado]);
    if (verificarEmail.rows.length > 0) {
      return res.status(400).json({ erro: 'Este e-mail já está em uso por outra conta.' });
    }

    const sql = `
      INSERT INTO Usuarios (nome_usuario, email, senha, data_nascimento, telefone, cpf_cnpj, tipo_usuario)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id_usuario, nome_usuario, email, tipo_usuario;
    `;
    
    const valores = [nome_usuario.trim(), emailTratado, senha.trim(), data_nascimento, telefone, cpf_cnpj, tipo_usuario];
    const resultado = await db.query(sql, valores);

    res.status(201).json({
      mensagem: 'Conta criada com sucesso!',
      usuario: resultado.rows[0]
    });
  } catch (err) {
    console.error('Erro ao cadastrar utilizador:', err);
    res.status(500).json({ erro: 'Erro ao guardar o utilizador na base de dados.' });
  }
});

// ROTAS DE RECUPERAÇÃO DE SENHA
app.post('/api/recuperar-senha', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: 'Por favor, informe o e-mail.' });

  try {
    const emailTratado = email.toLowerCase().trim();
    const resultado = await db.query(
      'SELECT id_usuario, nome_usuario, email FROM Usuarios WHERE LOWER(TRIM(email)) = $1',
      [emailTratado]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Nenhuma conta encontrada com este e-mail.' });
    }

    const usuario = resultado.rows[0];
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expiracao = new Date(Date.now() + 15 * 60 * 1000);

    await db.query(
      'UPDATE Usuarios SET codigo_recuperacao = $1, codigo_expiracao = $2 WHERE id_usuario = $3',
      [codigo, expiracao, usuario.id_usuario]
    );

    const mailOptions = {
      from: '"GatherTech" <engtailon@gmail.com>',
      to: usuario.email,
      subject: `${codigo} é o seu código de recuperação - GatherTech`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #0066FF;">GatherTech</h2>
          <p>Olá, <strong>${usuario.nome_usuario}</strong>!</p>
          <p>Utilize o código de verificação abaixo para continuar no aplicativo:</p>
          <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #0066FF;">${codigo}</span>
          </div>
          <p style="font-size: 13px; color: #666;">Este código é válido por <strong>15 minutos</strong>.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return res.json({ sucesso: true, mensagem: 'Código enviado com sucesso!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Não foi possível enviar o e-mail.' });
  }
});

app.post('/api/validar-codigo', async (req, res) => {
  const { email, codigo } = req.body;
  if (!email || !codigo) return res.status(400).json({ erro: 'Campos obrigatórios ausentes.' });

  try {
    const resultado = await db.query(
      `SELECT id_usuario FROM Usuarios 
       WHERE LOWER(TRIM(email)) = $1 AND codigo_recuperacao = $2 AND codigo_expiracao > NOW()`,
      [email.toLowerCase().trim(), codigo.trim()]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    }

    return res.json({ sucesso: true, mensagem: 'Código válido!' });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro interno.' });
  }
});

app.post('/api/redefinir-senha', async (req, res) => {
  const { email, codigo, novaSenha } = req.body;
  if (!email || !codigo || !novaSenha) return res.status(400).json({ erro: 'Campos obrigatórios.' });

  try {
    const emailTratado = email.toLowerCase().trim();
    const resultado = await db.query(
      `SELECT id_usuario FROM Usuarios 
       WHERE LOWER(TRIM(email)) = $1 AND codigo_recuperacao = $2 AND codigo_expiracao > NOW()`,
      [emailTratado, codigo.trim()]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Sessão expirada.' });
    }

    await db.query(
      `UPDATE Usuarios SET senha = $1, codigo_recuperacao = NULL, codigo_expiracao = NULL WHERE LOWER(TRIM(email)) = $2`,
      [novaSenha.trim(), emailTratado]
    );

    return res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso!' });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao atualizar a senha.' });
  }
});

// ==========================================
// ROTAS DE GESTÃO DE EVENTOS (CRUD COMPLETO)
// ==========================================

// Listar todos os eventos
app.get('/api/eventos', async (req, res) => {
  try {
    const resultado = await db.query('SELECT * FROM Eventos ORDER BY id_evento DESC');
    res.json(resultado.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar eventos.' });
  }
});

// Cadastrar novo evento
app.post('/api/eventos', async (req, res) => {
  const {
    nome_evento, imagem, modalidade, data_inicio, horario_inicio,
    descricao_evento, data_fim, horario_fim, tipo_ingresso, nome_produtor,
    descricao_produtor, url_inscricao, id_tipo_evento = 1 
  } = req.body;

  try {
    const sql = `
      INSERT INTO Eventos (
        id_tipo_evento, nome_evento, imagem, modalidade, data_inicio, horario_inicio,
        descricao_evento, data_fim, horario_fim, tipo_ingresso, nome_produtor,
        descricao_produtor, url_inscricao, data_publicacao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *;
    `;

    const valores = [
      id_tipo_evento, nome_evento,
      imagem || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=600',
      modalidade || 'Presencial', data_inicio, horario_inicio, descricao_evento,
      data_fim, horario_fim, tipo_ingresso || 'Gratuito', nome_produtor,
      descricao_produtor, url_inscricao
    ];

    const resultado = await db.query(sql, valores);
    res.status(201).json({ mensagem: 'Evento criado!', evento: resultado.rows[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar evento.' });
  }
});

// Atualizar evento existente (Editar)
app.put('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;
  const {
    nome_evento, imagem, modalidade, data_inicio, horario_inicio,
    descricao_evento, data_fim, horario_fim, tipo_ingresso, nome_produtor,
    descricao_produtor, url_inscricao
  } = req.body;

  try {
    const sql = `
      UPDATE Eventos SET
        nome_evento = $1, imagem = $2, modalidade = $3, data_inicio = $4, horario_inicio = $5,
        descricao_evento = $6, data_fim = $7, horario_fim = $8, tipo_ingresso = $9, nome_produtor = $10,
        descricao_produtor = $11, url_inscricao = $12
      WHERE id_evento = $13
      RETURNING *;
    `;

    const valores = [
      nome_evento, imagem, modalidade, data_inicio, horario_inicio,
      descricao_evento, data_fim, horario_fim, tipo_ingresso, nome_produtor,
      descricao_produtor, url_inscricao, id
    ];

    const resultado = await db.query(sql, valores);
    res.json({ mensagem: 'Evento atualizado com sucesso!', evento: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar evento:', err);
    res.status(500).json({ erro: 'Erro ao atualizar evento.' });
  }
});

// Excluir evento
app.delete('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM Eventos WHERE id_evento = $1', [id]);
    res.json({ mensagem: 'Evento excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir evento:', err);
    res.status(500).json({ erro: 'Erro ao excluir evento.' });
  }
});

// ==========================================
// ROTAS EXCLUSIVAS DE ADMINISTRAÇÃO PAINEL
// ==========================================

// Consultar Métricas Gerais do App
app.get('/api/admin/metricas', async (req, res) => {
  try {
    const totalUsuarios = await db.query('SELECT COUNT(*) FROM Usuarios');
    const totalEventos = await db.query('SELECT COUNT(*) FROM Eventos');

    res.json({
      totalUsuarios: parseInt(totalUsuarios.rows[0].count, 10),
      totalEventos: parseInt(totalEventos.rows[0].count, 10),
      statusSistema: 'Online'
    });
  } catch (err) {
    console.error('Erro ao buscar métricas:', err);
    res.status(500).json({ erro: 'Erro ao carregar métricas.' });
  }
});

// Listar todos os usuários para o Painel Admin
app.get('/api/admin/usuarios', async (req, res) => {
  try {
    const resultado = await db.query(
      'SELECT id_usuario, nome_usuario, email, tipo_usuario, telefone FROM Usuarios ORDER BY id_usuario DESC'
    );
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({ erro: 'Erro ao buscar usuários.' });
  }
});

// Atualizar permissões/dados do usuário pelo Admin
app.put('/api/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { tipo_usuario, nome_usuario, email } = req.body;

  try {
    await db.query(
      'UPDATE Usuarios SET tipo_usuario = $1, nome_usuario = $2, email = $3 WHERE id_usuario = $4',
      [tipo_usuario, nome_usuario, email, id]
    );
    res.json({ mensagem: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ erro: 'Erro ao atualizar usuário.' });
  }
});

// Excluir conta de usuário pelo Admin
app.delete('/api/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM Usuarios WHERE id_usuario = $1', [id]);
    res.json({ mensagem: 'Usuário excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir usuário:', err);
    res.status(500).json({ erro: 'Erro ao excluir usuário.' });
  }
});

// INICIALIZAÇÃO DO SERVIDOR
const PORTA = 3000;
app.listen(PORTA, () => {
  console.log(`Servidor a rodar na porta ${PORTA}`);
});