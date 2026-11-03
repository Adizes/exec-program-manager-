# Adizes · Exec Program Manager

Plataforma para gestionar los cohorts del **Adizes Executive Program**. Reemplaza los Google Sheets "Cohort X – Matrix".

- **Program Managers (PM):** lo gestionan todo: cohorts, calendario, asistencia, LMS, feedback, conversaciones, correos y equipo.
- **SMEs:** ven los cohorts donde imparten; el feedback solo cuando la PM lo comparte con ellos.
- **Learners:** reciben un link personal para llenar su perfil y sus Goals & Intentions, en el idioma de su cohort.

## Cómo está armado

| Pieza | Dónde vive |
|---|---|
| Página del staff y formulario del learner | Webflow: un *Code Embed* que carga `dist/epm.min.js` desde jsDelivr |
| Backend y base de datos | Google Apps Script (`apps-script/Code.gs`) ligado a un Google Sheet en la cuenta **execprogram@adizes.com** |
| LMS | API de Teachable: sincroniza cada noche y también desde el botón **Sync now** |
| Module feedback | Typeform: links personalizados con hidden fields; las respuestas se jalan cada noche o con un botón |
| Asistencia | Se sube el CSV de participantes de Zoom y se marca Present/Absent automáticamente |

- **Acceso:** se entra con el correo @adizes.com y un código de 6 dígitos que llega por correo. Solo pueden entrar las personas dadas de alta en **Team**.
- **Datos personales y llaves:** nada de esto vive en este repo, que es público.
  - Los datos están en el Google Sheet.
  - Las llaves van en las *Script Properties* del Apps Script.

---

## Puesta en marcha (una sola vez)

### 1. Google Sheet + Apps Script
Haz todo con la cuenta **execprogram@adizes.com**: de ahí salen los correos.

1. Crea un Google Sheet nuevo y llámalo `Exec Program Manager — DB`. No le agregues nada; la plataforma crea sus pestañas sola.
2. Abre **Extensiones → Apps Script**. Borra lo que haya y pega todo el contenido de `apps-script/Code.gs`.
3. Al inicio del archivo, en `CONFIG`, revisa:
   - `PORTAL_URL`: la página de Webflow del staff (paso 3).
   - `LEARNER_URL`: la página de Webflow del formulario del learner (paso 3).
   - `INITIAL_PMS`: los correos que serán Program Managers desde el inicio.
4. Ve a **⚙️ Configuración del proyecto**:
   - Pon la zona horaria en `(GMT-06:00) Ciudad de México`.
   - Abajo, en **Propiedades de la secuencia de comandos**, agrega:

     | Propiedad | Valor |
     |---|---|
     | `TEACHABLE_API_KEY` | la API key de Teachable (**genera una nueva**: la anterior quedó expuesta) |
     | `TEACHABLE_BASIC_USER` | el usuario de Teachable |
     | `TEACHABLE_BASIC_PASS` | la contraseña de Teachable (**cámbiala**: la anterior quedó expuesta) |
     | `TYPEFORM_TOKEN` | un *personal access token* de Typeform (Account → Personal tokens, con permiso de leer respuestas) |
5. Arriba, elige la función **setup** y presiona **▶ Ejecutar**. Acepta los permisos que pida Google. Esto:
   - crea las pestañas;
   - da de alta a los PMs iniciales;
   - programa la sincronización nocturna (5 am).
6. Ve a **Implementar → Nueva implementación → Aplicación web**:
   - **Ejecutar como:** Yo.
   - **Quién tiene acceso:** Cualquier usuario.

   Copia la URL que termina en `/exec`.

### 2. GitHub
Crea un release para que jsDelivr sirva el archivo: **Releases → Draft a new release → tag `v1.0.0` → Publish**.

### 3. Webflow
Crea dos páginas:

- **`/exec-program-manager`** (staff)
- **`/exec-program-profile`** (formulario del learner)

En cada una:
- Agrega un **Code Embed** de ancho completo con el código de `EMBED.html`, poniendo tu URL `/exec`.
- En **Page settings → SEO**, márcala como *Exclude from search results*.

> Conviene que esas páginas no muestren el navbar ni el footer del sitio.

### 4. Primer ingreso e importación
1. Entra a `/exec-program-manager` con `execprogram@adizes.com`. Te llega un código a ese buzón.
2. En **Team**, invita a las Program Managers y a los SMEs. Cada uno debe tener correo @adizes.com.
   - Al invitar a un SME, elige su nombre en **Link imported name**. Así sus bloques y ratings anteriores quedan ligados a su cuenta.
3. En **Settings → Import from the old Matrix sheets**, sube los `.json` de cada cohort. Esos archivos se mandan aparte y **nunca se suben a GitHub**.
4. Revisa el calendario de cada cohort en **Settings → Structure & dates**:
   - SMEs por bloque.
   - IDs de cursos de Teachable.
   - Si el SME puede ver su feedback.
   - Los cohorts 7 y 1 SPA venían con fechas copiadas del 6: revísalas.

### 5. Typeform (Module feedback)
1. En el form de Module Feedback, agrega 4 **hidden fields** con estos nombres exactos: `email`, `name`, `cohort`, `module`.
2. Copia el ID del form. Es lo que va después de `/to/` en el link.
3. Pégalo en **Settings → Typeform**: hay uno para inglés y otro para español.

Desde **Feedback → Module feedback → Links** puedes copiar el link de cada learner o mandarlo por correo a quienes no han respondido.

---

## Uso diario

### Asistencia con Zoom
1. En Zoom, ve a **Reports → Usage**.
2. Abre la reunión y haz clic en el número de **Participants**.
3. Presiona **Export**.
4. En la plataforma, ve a **Attendance → Import Zoom CSV** y sube el archivo.

Qué hace la plataforma con el archivo:
- Detecta la sesión por la fecha.
- Empareja a cada participante por correo o por nombre.
- Marca **Present** a quien estuvo al menos el % configurado de la sesión (50% por omisión).

Si alguien entró con otro nombre (por ejemplo, "iPhone de Ana"), le asignas quién es una vez y la plataforma lo recuerda.

### Correos
Salen de execprogram@ en el idioma del cohort y quedan registrados en **Conversations**.

| Plantilla | Estado |
|---|---|
| Perfil / Goals | Lista |
| Module feedback | Lista |
| Correo libre | Lista |
| Certificado | Texto pendiente; se edita en `EMAILS` dentro de `Code.gs` |
| Tutorial de LinkedIn | Texto pendiente; se edita en `EMAILS` dentro de `Code.gs` |

### Learners
- **Agregar:** se da de alta a la persona con nombre y correo, y recibe su link personal.
- **Mover de cohort:** abre al learner y entra a **Program**. Su historial se conserva.
- **Dar de baja:** cambia su estatus a *Dropped Out*.

---

## Publicar una nueva versión

**Si cambió la página (carpeta `src/`):**
1. Ejecuta `npm run build` y `npm test`, y haz commit.
2. Crea un release nuevo, por ejemplo `v1.0.1`.
3. En los dos Code Embeds de Webflow, cambia `@v1.0.0` por la versión nueva y publica.

**Si cambió `apps-script/Code.gs`:**
1. Pégalo en el editor de Apps Script.
2. Ve a **Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión**.

## Para desarrollo

```bash
npm install
npm run build                 # dist/epm.js y dist/epm.min.js
npm test                      # Code.gs real en Node + Playwright (escritorio y celular)
IMPORT_DIR=/ruta/json npm test   # lo mismo, con datos reales importados
npm run dev                   # http://localhost:8787 (los códigos de acceso salen en /__emails)
python3 tools/migrate.py "Cohort 4 - Matrix.xlsx" --name "Cohort 4" --out cohort-4.json
```
