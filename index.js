// ===== PACOTES E CONFIGURAÇÃO INICIAL =====
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const mqtt = require('mqtt');

const app = express();
// A porta 10000 é a porta padrão que o Render espera.
const PORT = process.env.PORT || 10000; 

// ===== MIDDLEWARE JSON COM CAPTURA DE RAW BODY =====
// Esta é a correção crucial para a validação da assinatura.
app.use(express.json({
  verify: (req, res, buf) => {
    // Salva o corpo bruto (raw body) em uma nova propriedade 'req.rawBody'
    req.rawBody = buf;
  }
}));

// ===== CONFIGURAÇÃO E CONEXÃO MQTT =====
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO || 'watervendor/maquina01/comandos';

console.log('🔧 Configurações MQTT Carregadas:');
console.log('   - URL:', MQTT_BROKER_URL ? '***[Presente]***' : '❌ [FALTANDO]');
console.log('   - Usuário:', MQTT_USERNAME || '❌ [FALTANDO]');
console.log('   - Tópico:', MQTT_TOPIC_COMANDO);

const mqttOptions = {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: false,
};

console.log('🔄 Tentando conectar ao Broker MQTT...');
const client = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

client.on('connect', () => {
  console.log('✅ Conectado ao Broker MQTT com sucesso!');
});

client.on('error', (err) => {
  console.log('❌ Erro na conexão MQTT:', err.message);
});

client.on('close', () => {
  console.log('🔌 Conexão MQTT fechada.');
});

// ===== ROTA DE HEALTH CHECK (PARA O RENDER) =====
app.get('/', (req, res) => {
  const statusMQTT = client.connected ? 'Conectado' : 'Desconectado';
  res.send(`
    <html>
      <body>
        <h1>Servidor WaterVendor Online</h1>
        <p>Status MQTT: <strong>${statusMQTT}</strong></p>
        <p>Webhook MP: <code>POST /notificacao-mp</code></p>
      </body>
    </html>
  `);
});

// ===== ROTA DO WEBHOOK MERCADO PAGO (VERSÃO FINAL COM DEBUG) =====
app.post('/notificacao-mp', (req, res) => {
  console.log('📥 Webhook recebido do Mercado Pago');

  try {
    // 1. Pegar o Header e o Segredo
    const signatureHeader = req.headers['x-signature'] || req.headers['x-signature-sha256'];
    const payload = req.rawBody; // O corpo bruto que já salvamos
    const secret = process.env.MP_WEBHOOK_SECRET;

    if (!signatureHeader) {
      console.log('❌ FALHA: Header [x-signature] ausente.');
      return res.status(400).send('Header ausente.');
    }

    if (!payload) {
      console.log('❌ FALHA: [req.rawBody] está vazio ou ausente.');
      return res.status(400).send('Corpo ausente.');
    }

    // 2. Parsear o Header para pegar o timestamp (ts) e o hash (v1)
    const parts = signatureHeader.split(',');
    const timestamp = parts.find(part => part.startsWith('ts=')).split('=')[1];
    const mpHash = parts.find(part => part.startsWith('v1=')).split('=')[1];

    if (!timestamp || !mpHash) {
      console.log('❌ Header de assinatura malformado.');
      return res.status(400).send('Header malformado.');
    }

    // 3. Criar a "Base String" que o MP realmente assina: timestamp + "." + corpo_bruto
    const manifest = `${timestamp}.${payload.toString()}`;

    // 4. Calcular nossa própria assinatura usando o Segredo
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    // 5. Comparar o hash do MP (v1) com o nosso hash calculado
    const ourSignatureBuffer = Buffer.from(expectedSignature, 'hex');
    const mpSignatureBuffer = Buffer.from(mpHash, 'hex');

    // ===== LOG DE DEBUG DETALHADO =====
    console.log('--- DEBUG DE COMPARAÇÃO ---');
    console.log('HASH (Mercado Pago):', mpHash);
    console.log('HASH (Nosso Cálculo):', expectedSignature);
    console.log('--- FIM DO DEBUG ---');
    // ==================================

    if (!crypto.timingSafeEqual(ourSignatureBuffer, mpSignatureBuffer)) {
      // As assinaturas não batem
      throw new Error('Assinaturas não batem.');
    }

    // 6. SUCESSO! A assinatura é válida.
    console.log('✅ Assinatura de webhook validada.');

    // 7. Processar o Pagamento (Foco na Aprovação)
    const { type, data } = req.body; // Usamos o req.body (parseado) só agora

    if (type === 'payment' && data.id) {
      console.log(`💰 Processando pagamento: ${data.id}`);

      // 8. Publicar comando MQTT
      if (client.connected) {
        const comando = 'LIBERAR_AGUA';
        client.publish(MQTT_TOPIC_COMANDO, comando, { qos: 1 }, (err) => {
          if (err) {
            console.log('❌ Erro ao publicar comando MQTT:', err);
          } else {
            console.log(`✅ Comando MQTT "${comando}" publicado no tópico: ${MQTT_TOPIC_COMANDO}`);
          }
        });
      } else {
        console.log('❌ Broker MQTT não conectado. Comando não enviado.');
      }

      res.status(200).json({ status: 'Webhook processado', comando: 'LIBERAR_AGUA' });
    } else {
      res.status(200).json({ status: 'Webhook ignorado (não é pagamento)' });
    }

  } catch (err) {
    console.log('❌ Assinatura de webhook inválida.');
    console.log('Erro:', err.message); // Imprime o erro exato (ex: "Assinaturas não batem.")
    return res.status(401).send('Assinatura inválida');
  }
});

// ===== INICIAR O SERVIDOR =====
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});