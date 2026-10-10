import { useState, useEffect } from 'react';
import { db, auth } from './firebaseConfig';
import { collectionGroup, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import './App.css';

function App() {
  const [signos, setSignos] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    // Iniciar sesión anónimamente para tener permiso de lectura
    signInAnonymously(auth).then(() => setConectado(true)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!conectado) return;

    // Escuchar los últimos signos vitales de TODOS los pacientes
    const qSignos = query(collectionGroup(db, 'historial_signos'), orderBy('timestamp', 'desc'), limit(15));
    const unsubSignos = onSnapshot(qSignos, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        pacienteId: doc.ref.parent.parent?.id || 'Desconocido',
        ...doc.data()
      }));
      setSignos(data);
    }, (error) => {
      console.error("Error signos:", error);
      if (error.message.includes("index")) {
        alert("Falta crear un índice. Abre la consola (F12) y haz clic en el link azul para crearlo.");
      }
    });

    // Escuchar alertas críticas de TODOS los pacientes
    const qAlertas = query(collectionGroup(db, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(5));
    const unsubAlertas = onSnapshot(qAlertas, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        pacienteId: doc.ref.parent.parent?.id || 'Desconocido',
        ...doc.data()
      }));
      setAlertas(data);
    }, (error) => {
      console.error("Error alertas:", error);
    });

    return () => {
      unsubSignos();
      unsubAlertas();
    };
  }, [conectado]);

  // Agrupar los signos vitales por paciente (para mostrar solo el más reciente de cada uno)
  const pacientesActuales = signos.reduce((acc, curr) => {
    if (!acc[curr.pacienteId]) {
      acc[curr.pacienteId] = curr;
    }
    return acc;
  }, {});

  return (
    <div className="dashboard-container">
      <header className="header">
        <h1>🏥 Central de Monitoreo VitaLink</h1>
        <div className={`status-badge ${conectado ? 'online' : 'offline'}`}>
          {conectado ? '🟢 Conectado a la Nube' : '🔴 Desconectado'}
        </div>
      </header>

      <main className="main-content">
        <section className="panel alertas-panel">
          <h2>🚨 Alertas Críticas (Tiempo Real)</h2>
          {alertas.length === 0 ? (
            <p className="empty-state">No hay alertas recientes. Todo en orden.</p>
          ) : (
            <div className="alertas-list">
              {alertas.map(alerta => (
                <div key={alerta.id} className="alerta-card blinking">
                  <div className="alerta-icono">⚠️</div>
                  <div className="alerta-info">
                    <strong>¡ALERTA DE {alerta.tipo}!</strong>
                    <p>Paciente ID: {alerta.pacienteId}</p>
                    <small>{alerta.timestamp?.toDate().toLocaleTimeString()}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel pacientes-panel">
          <h2>🩺 Pacientes Activos</h2>
          {Object.keys(pacientesActuales).length === 0 ? (
            <p className="empty-state">Esperando datos de las pulseras...</p>
          ) : (
            <div className="pacientes-grid">
              {Object.values(pacientesActuales).map(paciente => (
                <div key={paciente.pacienteId} className="paciente-card">
                  <div className="paciente-header">
                    <h3>ID: {paciente.pacienteId.substring(0, 8)}</h3>
                    <span className="bateria">🔋 {paciente.bateria}%</span>
                  </div>
                  <div className="signos-grid">
                    <div className="signo">
                      <span className="signo-valor">{paciente.bpm}</span>
                      <span className="signo-label">BPM</span>
                    </div>
                    <div className="signo">
                      <span className="signo-valor">{paciente.spo2}</span>
                      <span className="signo-label">% SpO2</span>
                    </div>
                  </div>
                  <div className="paciente-footer">
                    <small>Última actualización: {paciente.timestamp?.toDate().toLocaleTimeString() || '...'}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
