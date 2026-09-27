// Configuración de la página de seguimiento de la boda
window.CONFIG = {                                         // Objeto global que lee app.js
  SUPABASE_URL: "",                                       // URL del proyecto Supabase (vacío = modo demostración)
  SUPABASE_ANON_KEY: "",                                  // Llave pública "anon" de Supabase (es pública por diseño)
  FECHA_BODA: "2027-01-30",                               // Fecha de la boda (AAAA-MM-DD) para la cuenta regresiva
  DIAS_ALERTA: 15,                                        // Días de anticipación para marcar una tarea como "Próxima"
  ESTADOS: ["No iniciado", "En proceso", "Terminado"],         // Estados posibles, en el orden del tablero
  GRUPOS: {                                               // Grupos de tareas: la letra es el prefijo del código
    A: "Vestuario y arreglo – Ana",                       // Grupo A
    B: "Vestuario y arreglo – Juan",                      // Grupo B
    C: "Ceremonia religiosa y trámites",                  // Grupo C
    D: "Lugar y organización",                            // Grupo D
    E: "Fotografía, video y entretenimiento",             // Grupo E
    F: "Recepción y ambientación",                        // Grupo F
    G: "Invitados y comunicación",                        // Grupo G
    H: "Logística del día",                               // Grupo H
    I: "Presupuesto y cierre",                            // Grupo I
    J: "Luna de miel"                                     // Grupo J
  }                                                       // Fin de grupos
};                                                        // Fin de la configuración
