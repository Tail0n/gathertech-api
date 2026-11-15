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
      nome_produtor || 'Não informado',
      descricao_produtor || null
    ];

    const resultado = await db.query(sql, valores);
    const eventoCriado = resultado.rows[0];

    try {
      await db.query(
        `INSERT INTO Notificacoes (id_usuario_destino, id_evento, tipo, titulo, mensagem)
         SELECT id_usuario, $1, 'novo_evento', 'Novo evento disponível!', $2
         FROM Usuarios`,
        [
          eventoCriado.id_evento,
          `O evento "${eventoCriado.nome_evento}" (${eventoCriado.tech || 'Tech'}) acabou de ser publicado.`
        ]
      );
    } catch (notifErr) {
      console.error('Aviso: falha ao gerar notificações de novo evento:', notifErr.message);
    }

    res.status(201).json({ mensagem: 'Evento criado com sucesso!', evento: eventoCriado });
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
    await db.query('DELETE FROM ComentariosEventos WHERE id_evento = $1', [id]);
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

// 1. Métricas Completas
app.get('/api/admin/metricas', async (req, res) => {
  try {
    const totalUsuarios = await db.query('SELECT COUNT(*) FROM Usuarios');
    const totalEventos = await db.query('SELECT COUNT(*) FROM Eventos');
    const totalComentarios = await db.query('SELECT COUNT(*) FROM ComentariosEventos');
    const mediaGeral = await db.query(
      'SELECT COALESCE(ROUND(AVG(nota_avaliacao), 1), 0.0) AS media FROM ComentariosEventos WHERE nota_avaliacao IS NOT NULL'
    );
    const porModalidade = await db.query(
      `SELECT COALESCE(modalidade, 'Presencial') AS modalidade, COUNT(*)::int AS total FROM Eventos GROUP BY modalidade`
    );
    const topTechs = await db.query(
      `SELECT COALESCE(tech, 'Geral') AS tech, COUNT(*)::int AS total FROM Eventos GROUP BY tech ORDER BY total DESC LIMIT 5`
    );

    res.json({
      totalUsuarios: parseInt(totalUsuarios.rows[0].count, 10),
      totalEventos: parseInt(totalEventos.rows[0].count, 10),
      totalComentarios: parseInt(totalComentarios.rows[0].count, 10),
      mediaAvaliacoes: parseFloat(mediaGeral.rows[0].media || 0).toFixed(1),
      porModalidade: porModalidade.rows,
      topTechs: topTechs.rows,
      statusSistema: 'Online'
    });
  } catch (err) {
    console.error('Erro ao buscar métricas:', err);
    res.status(500).json({ erro: 'Erro ao carregar métricas.' });
  }
});

// 2. Gestão de Usuários (Suporte a Cadastros)
app.get('/api/admin/usuarios', async (req, res) => {
  try {
    const resultado = await db.query(
      'SELECT id_usuario, nome_usuario, email, tipo_usuario, telefone, cpf_cnpj FROM Usuarios ORDER BY id_usuario DESC'
    );
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({ erro: 'Erro ao buscar usuários.' });
  }
});

app.put('/api/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nome_usuario, email, telefone, tipo_usuario, nova_senha } = req.body;

  try {
    const emailTratado = email ? email.toLowerCase().trim() : null;

    if (emailTratado) {
      const duplicado = await db.query(
        'SELECT id_usuario FROM Usuarios WHERE LOWER(TRIM(email)) = $1 AND id_usuario <> $2',
        [emailTratado, id]
      );
      if (duplicado.rows.length > 0) {
        return res.status(400).json({ erro: 'Já existe outro utilizador com este e-mail.' });
      }
    }

    const sql = `
      UPDATE Usuarios
      SET nome_usuario = COALESCE($1, nome_usuario),
          email = COALESCE($2, email),
          telefone = COALESCE($3, telefone),
          tipo_usuario = COALESCE($4, tipo_usuario)
      WHERE id_usuario = $5
      RETURNING id_usuario, nome_usuario, email, tipo_usuario, telefone, cpf_cnpj;
    `;
    const resultado = await db.query(sql, [
      nome_usuario?.trim() || null,
      emailTratado,
      telefone?.trim() || null,
      tipo_usuario || null,
      id
    ]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    // Se o admin definiu uma nova senha para resolver problema de acesso
    if (nova_senha && nova_senha.trim() !== '') {
      await db.query('UPDATE Usuarios SET senha = $1 WHERE id_usuario = $2', [nova_senha.trim(), id]);
    }

    res.json({ mensagem: 'Cadastro atualizado com sucesso!', usuario: resultado.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar utilizador pelo admin:', err);
    res.status(500).json({ erro: 'Erro ao atualizar cadastro.' });
  }
});

app.delete('/api/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM CurtidasComentarios WHERE id_usuario = $1', [id]);
    await db.query('DELETE FROM ComentariosEventos WHERE id_usuario = $1', [id]);
    await db.query('DELETE FROM Notificacoes WHERE id_usuario_destino = $1 OR id_usuario_origem = $1', [id]);
    await db.query('DELETE FROM Usuarios WHERE id_usuario = $1', [id]);
    res.json({ mensagem: 'Utilizador removido com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir utilizador:', err);
    res.status(500).json({ erro: 'Erro ao excluir utilizador.' });
  }
});

// 3. Moderação de Comentários
app.get('/api/admin/comentarios', async (req, res) => {
  try {
    const sql = `
      SELECT c.*, u.nome_usuario, u.email, e.nome_evento
      FROM ComentariosEventos c
      LEFT JOIN Usuarios u ON c.id_usuario = u.id_usuario
      LEFT JOIN Eventos e ON c.id_evento = e.id_evento
      ORDER BY c.id_comentario DESC
      LIMIT 100;
    `;
    const resultado = await db.query(sql);
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao listar comentários no admin:', err);
    res.status(500).json({ erro: 'Erro ao carregar comentários.' });
  }
});

app.delete('/api/admin/comentarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM CurtidasComentarios WHERE id_comentario = $1', [id]);
    await db.query('DELETE FROM ComentariosEventos WHERE id_comentario_pai = $1', [id]);
    await db.query('DELETE FROM ComentariosEventos WHERE id_comentario = $1', [id]);
    res.json({ mensagem: 'Comentário removido com sucesso!' });
  } catch (err) {
    console.error('Erro ao apagar comentário:', err);
    res.status(500).json({ erro: 'Erro ao apagar comentário.' });
  }
});

// 4. Comunicado Global (Broadcast para todos os usuários)
app.post('/api/admin/notificacoes/broadcast', async (req, res) => {
  const { titulo, mensagem } = req.body;
  if (!titulo || !mensagem) {
    return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
  }
  try {
    await db.query(
      `INSERT INTO Notificacoes (id_usuario_destino, tipo, titulo, mensagem)
       SELECT id_usuario, 'novo_evento', $1, $2 FROM Usuarios`,
      [titulo.trim(), mensagem.trim()]
    );
    res.status(201).json({ mensagem: 'Comunicado enviado para todos os utilizadores!' });
  } catch (err) {
    console.error('Erro ao enviar comunicado:', err);
    res.status(500).json({ erro: 'Erro ao enviar comunicado global.' });
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

    const novoRegistro = resultado.rows[0];

    if (id_comentario_pai && textoTratado !== '') {
      try {
        const paiRes = await db.query(
          'SELECT id_usuario FROM ComentariosEventos WHERE id_comentario = $1',
          [id_comentario_pai]
        );
        if (paiRes.rows.length > 0) {
          const idAutorPai = paiRes.rows[0].id_usuario;
          if (String(idAutorPai) !== String(id_usuario)) {
            const trecho = textoTratado.length > 70 ? `${textoTratado.substring(0, 70)}...` : textoTratado;
            await db.query(
              `INSERT INTO Notificacoes (id_usuario_destino, id_usuario_origem, id_evento, tipo, titulo, mensagem)
               VALUES ($1, $2, $3, 'resposta', 'Responderam ao seu comentário', $4)`,
              [idAutorPai, id_usuario, id, `${novoRegistro.nome_usuario} respondeu: "${trecho}"`]
            );
          }
        }
      } catch (notifErr) {
        console.error('Aviso: falha ao gerar notificação de resposta:', notifErr.message);
      }
    }

    res.status(201).json({ 
      mensagem: 'Comentário/Avaliação registrada com sucesso!', 
      comentario: novoRegistro 
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

      try {
        const comentarioRes = await db.query(
          'SELECT id_usuario, id_evento, texto_comentario FROM ComentariosEventos WHERE id_comentario = $1',
          [id]
        );
        const origemRes = await db.query(
          'SELECT nome_usuario FROM Usuarios WHERE id_usuario = $1',
          [id_usuario]
        );

        if (comentarioRes.rows.length > 0 && origemRes.rows.length > 0) {
          const autorComentario = comentarioRes.rows[0].id_usuario;
          const idEvento = comentarioRes.rows[0].id_evento;
          const textoComent = comentarioRes.rows[0].texto_comentario || '';
          const nomeCurtiu = origemRes.rows[0].nome_usuario;

          if (String(autorComentario) !== String(id_usuario)) {
            const resumo = textoComent.length > 50 ? `${textoComent.substring(0, 50)}...` : textoComent;
            const msg = resumo
              ? `${nomeCurtiu} curtiu o seu comentário: "${resumo}"`
              : `${nomeCurtiu} curtiu a sua avaliação.`;

            await db.query(
              `INSERT INTO Notificacoes (id_usuario_destino, id_usuario_origem, id_evento, tipo, titulo, mensagem)
               VALUES ($1, $2, $3, 'curtida', 'Nova curtida no seu comentário', $4)`,
              [autorComentario, id_usuario, idEvento, msg]
            );
          }
        }
      } catch (notifErr) {
        console.error('Aviso: falha ao gerar notificação de curtida:', notifErr.message);
      }

      res.json({ curtiu: true, mensagem: 'Curtida registrada!' });
    }
  } catch (err) {
    console.error('Erro ao processar curtida:', err);
    res.status(500).json({ erro: 'Erro ao processar curtida.' });
  }
});

// ==========================================
// ROTAS DE NOTIFICAÇÕES
// ==========================================

app.get('/api/usuarios/:id/notificacoes', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT n.*, e.nome_evento
      FROM Notificacoes n
      LEFT JOIN Eventos e ON n.id_evento = e.id_evento
      WHERE n.id_usuario_destino = $1
      ORDER BY n.data_criacao DESC
      LIMIT 50;
    `;
    const resultado = await db.query(sql, [id]);
    res.json(resultado.rows);
  } catch (err) {
    console.error('Erro ao buscar notificações:', err);
    res.status(500).json({ erro: 'Erro ao buscar notificações.' });
  }
});

app.put('/api/notificacoes/:id/ler', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE Notificacoes SET lida = TRUE WHERE id_notificacao = $1', [id]);
    res.json({ mensagem: 'Notificação marcada como lida.' });
  } catch (err) {
    console.error('Erro ao marcar notificação como lida:', err);
    res.status(500).json({ erro: 'Erro ao atualizar notificação.' });
  }
});

app.put('/api/usuarios/:id/notificacoes/ler-todas', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE Notificacoes SET lida = TRUE WHERE id_usuario_destino = $1', [id]);
    res.json({ mensagem: 'Todas as notificações foram marcadas como lidas.' });
  } catch (err) {
    console.error('Erro ao marcar todas como lidas:', err);
    res.status(500).json({ erro: 'Erro ao atualizar notificações.' });
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