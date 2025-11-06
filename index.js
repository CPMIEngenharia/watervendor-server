// V16 - server.js com logs MQTT melhorados
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const mqtt = require('mqtt');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parse do JSON
//app.use(express.json());
app.use(express.json({
  verify: (req, res, buf) => {
    // Salva o corpo bruto (raw body) em uma nova propriedade 'req.rawBody'
    req.rawBody = buf;
  }
}));

// ===== CONFIGURAÇÃO MQTT =====
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO || 'watervendor/maquina01/comandos';

console.log('🔧 Configurações MQTT Carregadas:');
console.log('   - URL:', MQTT_BROKER_URL ? '***[Presente]***' : '❌ [FALTANDO]');
console.log('   - Usuário:', MQTT_USERNAME || '❌ [FALTANDO]');
console.log('   - Tópico:', MQTT_TOPIC_COMANDO);

// Conexão MQTT com opções robustas
const mqttOptions = {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: false, // Importante para HiveMQ Cloud
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

// ===== WEBHOOK MERCADO PAGO =====
// COLE ESTE BLOCO CORRIGIDO NO LUGAR
app.post('/notificacao-mp', (req, res) => {
  console.log('📥 Webhook recebido do Mercado Pago');

  try {
    // 1. Pegar o Header e o Segredo
    const signatureHeader = req.headers['x-signature'] || req.headers['x-signature-sha256'];
    const payload = req.rawBody; // O corpo bruto que já salvamos
    const secret = process.env.MP_WEBHOOK_SECRET;

    if (!signatureHeader || !payload || !secret) {
      console.log('❌ Assinatura, Payload ou Segredo ausentes.');
      return res.status(400).send('Dados de webhook incompletos.');
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
    console.log('❌ Assinatura de webhook inválida. Possível tentativa de fraude.');
    console.log('Erro:', err.message);
    return res.status(401).send('Assinatura inválida');
  }
});

// Rota de Health Check para o Koyeb
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

// Inicializar Servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});