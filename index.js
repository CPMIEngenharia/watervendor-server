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
app.post('/notificacao-mp', (req, res) => {
  console.log('📥 Webhook recebido do Mercado Pago');

  // 1. Validar Assinatura
  const signature = req.headers['x-signature'] || req.headers['x-signature-sha256'];
 // const payload = JSON.stringify(req.body);
const payload = req.rawBody;
  if (!signature) {
    console.log('❌ Assinatura ausente no webhook.');
    return res.status(400).send('Assinatura ausente');
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  if (signature !== `sha256=${expectedSignature}`) {
    console.log('❌ Assinatura de webhook inválida. Possível tentativa de fraude.');
    return res.status(401).send('Assinatura inválida');
  }

  console.log('✅ Assinatura de webhook validada.');

  // 2. Processar o Pagamento (Foco na Aprovação)
  const { type, data } = req.body;

  if (type === 'payment' && data.id) {
    console.log(`💰 Processando pagamento: ${data.id}`);
    // Aqui você normalmente buscaria detalhes do pagamento na API do MP
    // Para simulação, vamos assumir que foi aprovado.

    // 3. Publicar comando MQTT
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