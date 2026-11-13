const express = require('express');
const cors = require('cors');
const db = require('./db');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

const app = express();

app.use(cors());
app.use(express.json());

const googleClient = new OAuth2Client();

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

app.get('/api/status', (req, res) => {
  res.json({ mensagem: 'A API do GatherTech está online e a escutar!' });
});

// ==========================================
// ROTAS DE AUTENTICAÇÃO E USUÁRIOS
// ==========================================

app.post('/api/auth/google', async (req, res) => {
  const { email, name, googleId } = req.body;
  if (!email) return res.status(400).json({ erro: 'O e-mail do Google é obrigatório.' });

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
    } else {
      usuarioLogado = resultado.rows[0];
    }

    return res.json({ mensagem: 'Autenticado com sucesso via Google!', usuario: usuarioLogado });
  } catch (err) {
    console.error('❌ Erro no login social Google:', err);
    return res.status(500).json({ erro: 'Erro interno ao autenticar com o Google.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });

  const emailTratado = email.toLowerCase().trim();
  try {
    const sql = `SELECT id_usuario, nome_usuario, email, tipo_usuario, foto_perfil FROM Usuarios WHERE LOWER(TRIM(email)) = $1 AND senha = $2;`;
    const resultado = await db.query(sql, [emailTratado, senha.trim()]);

    if (resultado.rows.length === 0) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

    res.json({ mensagem: 'Login efetuado com sucesso!', usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao efetuar login:', err);
    res.status(500).json({ erro: 'Erro ao validar login na base de dados.' });
  }
});

app.post('/api/cadastro', async (req, res) => {
  const { nome_usuario, email, senha, data_nascimento, telefone, cpf_cnpj, tipo_usuario = 'aluno' } = req.body;
  if (!nome_usuario || !email || !senha || !data_nascimento || !telefone || !cpf_cnpj) {
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
  }

  const emailTratado = email.toLowerCase().trim();
  try {
    const verificarEmail = await db.query('SELECT email FROM Usuarios WHERE LOWER(TRIM(email)) = $1', [emailTratado]);
    if (verificarEmail.rows.length > 0) return res.status(400).json({ erro: 'Este e-mail já está em uso.' });

    const sql = `INSERT INTO Usuarios (nome_usuario, email, senha, data_nascimento, telefone, cpf_cnpj, tipo_usuario) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_usuario, nome_usuario, email, tipo_usuario;`;
    const resultado = await db.query(sql, [nome_usuario.trim(), emailTratado, senha.trim(), data_nascimento, telefone, cpf_cnpj, tipo_usuario]);

    res.status(201).json({ mensagem: 'Conta criada com sucesso!', usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao cadastrar:', err);
    res.status(500).json({ erro: 'Erro ao guardar o utilizador.' });
  }
});

// ==========================================
// ROTAS DE GESTÃO DE EVENTOS (CRUD COMPLETO)
// ==========================================

app.get('/api/eventos', async (req, res) => {
  try {
    const sql = `
      SELECT e.*, 
             COALESCE(
               (SELECT ROUND(AVG(sub.ultima_nota), 1) 
                FROM (
                  SELECT DISTINCT ON (c.id_usuario) c.nota_avaliacao AS ultima_nota
                  FROM ComentariosEventos c
                  WHERE c.id_evento = e.id_evento AND c.nota_avaliacao IS NOT NULL
                  ORDER BY c.id_usuario, c.id_comentario DESC
                ) sub), 0.0
             ) AS media_avaliacao
      FROM Eventos e
      ORDER BY e.id_evento DESC;
    `;
    const resultado = await db.query(sql);
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao buscar eventos:', err);
    res.status(500).json({ erro: 'Erro ao buscar eventos.' });
  }
});

app.post('/api/eventos', async (req, res) => {
  const {
    titulo, nome_evento, imagem, galeria_imagens, modalidade, formato, cidade, estado, cep, bairro, rua_numero,
    data_inicio, horario_inicio, data_fim, horario_fim, descricao, descricao_evento,
    tipo_ingresso, preco, tech, plataforma_online, url_inscricao, link_oficial, nome_produtor, 
    descricao_produtor, id_tipo_evento = 1 
  } = req.body;

  try {
    const nomeEventoFinal = nome_evento || titulo;
    const descricaoFinal = descricao_evento || descricao;
    const modalidadeFinal = modalidade || formato;
    const ingressoFinal = tipo_ingresso || preco;

    const dataTratada = data_inicio && data_inicio.trim() !== '' ? data_inicio : new Date().toISOString().split('T')[0];
    const horaTratada = horario_inicio && horario_inicio.trim() !== '' ? horario_inicio : '08:00:00';
    
    const horaFimTratada = horario_fim && horario_fim.trim() !== '' ? horario_fim : '23:59:00';
    const dataFimTratada = data_fim && data_fim.trim() !== '' ? data_fim : dataTratada;

    const descricaoTratada = descricaoFinal && descricaoFinal.trim() !== '' ? descricaoFinal : 'Evento sem descrição informada.';
    const galeriaString = galeria_imagens ? (typeof galeria_imagens === 'string' ? galeria_imagens : JSON.stringify(galeria_imagens)) : null;

    const sql = `
      INSERT INTO Eventos (
        id_tipo_evento, nome_evento, imagem, galeria_imagens, modalidade, cidade, estado, cep, bairro, rua_numero,
        data_inicio, horario_inicio, data_fim, horario_fim, descricao_evento,
        tipo_ingresso, tech, plataforma_online, url_inscricao, link_oficial, nome_produtor, descricao_produtor, data_publicacao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
      RETURNING *;
    `;

    const valores = [
      id_tipo_evento, 
      nomeEventoFinal, 
      imagem || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=600',
      galeriaString,
      modalidadeFinal || 'Presencial', 
      cidade || 'Salvador', 
      estado || null, 
      cep || null, 
      bairro || null, 
      rua_numero || null,
      dataTratada, 
      horaTratada, 
      dataFimTratada, 
      horaFimTratada, 
      descricaoTratada,
      ingressoFinal || 'Gratuito', 
      tech || 'Geral', 
      plataforma_online || null, 
      url_inscricao || null, 
      link_oficial || null, 
      nome_produtor || 'Não informado', // Fallback perfeito caso não receba dados
      descricao_produtor || null
    ];

    const resultado = await db.query(sql, valores);
    res.status(201).json({ mensagem: 'Evento criado com sucesso!', evento: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao criar evento:', err);
    res.status(500).json({ erro: 'Erro ao criar evento.' });
  }
});

app.put('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;
  const {
    titulo, nome_evento, imagem, galeria_imagens, modalidade, formato, cidade, estado, cep, bairro, rua_numero,
    data_inicio, horario_inicio, data_fim, horario_fim, descricao, descricao_evento,
    tipo_ingresso, preco, tech, plataforma_online, url_inscricao, link_oficial, nome_produtor, descricao_produtor
  } = req.body;

  try {
    const nomeEventoFinal = nome_evento || titulo;
    const descricaoTratada = (descricao_evento || descricao) && (descricao_evento || descricao).trim() !== '' ? (descricao_evento || descricao) : 'Evento sem descrição informada.';
    const galeriaString = galeria_imagens ? (typeof galeria_imagens === 'string' ? galeria_imagens : JSON.stringify(galeria_imagens)) : null;
    const modalidadeFinal = modalidade || formato;
    const ingressoFinal = tipo_ingresso || preco;

    const sql = `
      UPDATE Eventos SET
        nome_evento = $1, imagem = $2, galeria_imagens = $3, modalidade = $4, cidade = $5, estado = $6, cep = $7,
        bairro = $8, rua_numero = $9, data_inicio = $10, horario_inicio = $11, data_fim = $12, horario_fim = $13,
        descricao_evento = $14, tipo_ingresso = $15, tech = $16, plataforma_online = $17,
        url_inscricao = $18, link_oficial = $19, nome_produtor = $20, descricao_produtor = $21
      WHERE id_evento = $22
      RETURNING *;
    `;

    const valores = [
      nomeEventoFinal, imagem, galeriaString, modalidadeFinal, cidade || 'Salvador', estado || null, cep || null,
      bairro || null, rua_numero || null, data_inicio, horario_inicio || '08:00:00', data_fim || null, horario_fim || null,
      descricaoTratada, ingressoFinal || 'Gratuito', tech || 'Geral', plataforma_online || null,
      url_inscricao || null, link_oficial || null, nome_produtor || 'Não informado', descricao_produtor || null, id
    ];

    const resultado = await db.query(sql, valores);
    res.json({ mensagem: 'Evento atualizado com sucesso!', evento: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar evento:', err);
    res.status(500).json({ erro: 'Erro ao atualizar evento.' });
  }
});

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

app.get('/api/admin/usuarios', async (req, res) => {
  try {
    const resultado = await db.query('SELECT id_usuario, nome_usuario, email, tipo_usuario, telefone FROM Usuarios ORDER BY id_usuario DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({ erro: 'Erro ao buscar usuários.' });
  }
});

// ==========================================
// ROTAS DE COMENTÁRIOS, AVALIAÇÕES E CURTIDAS
// ==========================================

app.get('/api/eventos/:id/comentarios', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT c.*, u.nome_usuario, u.foto_perfil,
             (SELECT COUNT(*) FROM CurtidasComentarios cur WHERE cur.id_comentario = c.id_comentario) AS curtidas,
             ARRAY(SELECT id_usuario FROM CurtidasComentarios cur WHERE cur.id_comentario = c.id_comentario) AS usuarios_curtiram
      FROM ComentariosEventos c
      JOIN Usuarios u ON c.id_usuario = u.id_usuario
      WHERE c.id_evento = $1
      ORDER BY c.id_comentario DESC;
    `;
    const resultado = await db.query(sql, [id]);
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao buscar comentários:', err);
    res.status(500).json({ erro: 'Erro ao buscar comentários.' });
  }
});

app.post('/api/eventos/:id/comentarios', async (req, res) => {
  const { id } = req.params;
  const { id_usuario, texto_comentario, nota_avaliacao, id_comentario_pai } = req.body;

  if (!id_usuario) {
    return res.status(400).json({ erro: 'ID do utilizador é obrigatório.' });
  }

  try {
    const textoTratado = (texto_comentario || '').trim();
    const notaTratada = nota_avaliacao || 5;

    const registrosExistentes = await db.query(
      'SELECT id_comentario FROM ComentariosEventos WHERE id_evento = $1 AND id_usuario = $2',
      [id, id_usuario]
    );

    if (textoTratado === '' && !id_comentario_pai && registrosExistentes.rows.length > 0) {
      await db.query(
        'UPDATE ComentariosEventos SET nota_avaliacao = $1 WHERE id_evento = $2 AND id_usuario = $3',
        [notaTratada, id, id_usuario]
      );

      return res.json({ 
        mensagem: 'Avaliação atualizada com sucesso!',
        comentario: { id_usuario, nota_avaliacao: notaTratada }
      });
    }

    if (registrosExistentes.rows.length > 0) {
      await db.query(
        'UPDATE ComentariosEventos SET nota_avaliacao = $1 WHERE id_evento = $2 AND id_usuario = $3',
        [notaTratada, id, id_usuario]
      );
    }

    const sql = `
      INSERT INTO ComentariosEventos (id_evento, id_usuario, nome_usuario, texto_comentario, nota_avaliacao, id_comentario_pai)
      SELECT $1, $2, u.nome_usuario, $3, $4, $5
      FROM Usuarios u WHERE u.id_usuario = $2
      RETURNING *;
    `;
    const valores = [id, id_usuario, textoTratado, notaTratada, id_comentario_pai || null];

    const resultado = await db.query(sql, valores);
    
    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    res.status(201).json({ 
      mensagem: 'Comentário/Avaliação registrada com sucesso!', 
      comentario: resultado.rows[0] 
    });
  } catch (err) {
    console.error('Erro ao salvar comentário/avaliação:', err);
    res.status(500).json({ erro: 'Erro ao registrar comentário/avaliação.' });
  }
});

app.post('/api/comentarios/:id/curtir', async (req, res) => {
  const { id } = req.params;
  const { id_usuario } = req.body;

  if (!id_usuario) {
    return res.status(400).json({ erro: 'ID do utilizador é obrigatório para curtir.' });
  }

  try {
    const checagem = await db.query(
      'SELECT * FROM CurtidasComentarios WHERE id_comentario = $1 AND id_usuario = $2', 
      [id, id_usuario]
    );
    
    if (checagem.rows.length > 0) {
      await db.query(
        'DELETE FROM CurtidasComentarios WHERE id_comentario = $1 AND id_usuario = $2', 
        [id, id_usuario]
      );
      res.json({ curtiu: false, mensagem: 'Curtida removida.' });
    } else {
      await db.query(
        'INSERT INTO CurtidasComentarios (id_comentario, id_usuario) VALUES ($1, $2)', 
        [id, id_usuario]
      );
      res.json({ curtiu: true, mensagem: 'Curtida registrada!' });
    }
  } catch (err) {
    console.error('Erro ao processar curtida:', err);
    res.status(500).json({ erro: 'Erro ao processar curtida.' });
  }
});

// ==========================================
// ROTAS DE PERFIL E SEGURANÇA DO UTILIZADOR
// ==========================================

app.put('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nome_usuario, email, telefone } = req.body;

  try {
    const emailTratado = email ? email.toLowerCase().trim() : null;
    
    const sql = `
      UPDATE Usuarios 
      SET nome_usuario = COALESCE($1, nome_usuario),
          email = COALESCE($2, email),
          telefone = COALESCE($3, telefone)
      WHERE id_usuario = $4
      RETURNING id_usuario, nome_usuario, email, telefone, tipo_usuario, foto_perfil;
    `;

    const valores = [nome_usuario, emailTratado, telefone, id];
    const resultado = await db.query(sql, valores);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    res.json({ 
      mensagem: 'Perfil atualizado com sucesso!', 
      usuario: resultado.rows[0] 
    });
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err);
    res.status(500).json({ erro: 'Erro ao atualizar perfil na base de dados.' });
  }
});

app.put('/api/usuarios/:id/foto', async (req, res) => {
  const { id } = req.params;
  const { foto_perfil } = req.body;

  try {
    await db.query(
      'UPDATE Usuarios SET foto_perfil = $1 WHERE id_usuario = $2', 
      [foto_perfil, id]
    );
    res.json({ mensagem: 'Foto atualizada com sucesso no banco de dados!' });
  } catch (err) {
    console.error('Erro ao atualizar foto:', err);
    res.status(500).json({ erro: 'Erro ao salvar a foto de perfil.' });
  }
});

app.put('/api/usuarios/:id/senha', async (req, res) => {
  const { id } = req.params;
  const { senha_atual, nova_senha } = req.body;

  try {
    const usuarioRes = await db.query('SELECT senha FROM Usuarios WHERE id_usuario = $1', [id]);

    if (usuarioRes.rows.length === 0) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    const usuario = usuarioRes.rows[0];

    if (usuario.senha !== senha_atual) {
      return res.status(400).json({ erro: 'Senha atual inválida.' });
    }

    await db.query('UPDATE Usuarios SET senha = $1 WHERE id_usuario = $2', [nova_senha, id]);

    res.json({ mensagem: 'Palavra-passe alterada com sucesso!' });
  } catch (err) {
    console.error('Erro ao alterar senha:', err);
    res.status(500).json({ erro: 'Erro no servidor ao alterar palavra-passe.' });
  }
});

const PORTA = 3000;
app.listen(PORTA, () => {
  console.log(`Servidor a rodar na porta ${PORTA}`);
});