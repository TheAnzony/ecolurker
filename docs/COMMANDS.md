# Referencia de comandos

> El bot marca y desmarca el rol `@Inactivo` **automáticamente** (al arrancar
> y cada `SYNC_INTERVAL_HOURS`, más el desmarcado inmediato al detectar voz).
> Estos comandos son para consultar el estado, ajustar el umbral o forzar una
> pasada; no hacen falta para el funcionamiento normal.

## `/configurar`

Configura cómo se trata la inactividad en este servidor. Permiso requerido:
`Manage Server`. Todos los cambios se aplican al momento (lanzan una
sincronización) y quedan guardados por servidor en la base de datos.

### `/configurar ver`

Muestra la configuración vigente: plazo general, rol de inactividad, cada
cuánto se revisa y la lista de roles con política propia.

### `/configurar dias dias:<n>`

Cambia el plazo general del servidor (entero entre 1 y 365). Si nunca se usa,
se aplica `DEFAULT_INACTIVE_DAYS` del `.env` (2 semanas).

```
/configurar dias dias:21
```

### `/configurar rol rol:<@rol> [dias] [marcar] [retirar] [mensaje]`

Da un trato especial a un rol. Los miembros que lo tengan dejan de seguir las
reglas generales.

**El bot no crea ninguna política por su cuenta.** Todo servidor —incluido uno
recién añadido— arranca sin políticas: solo existen las que se crean con este
comando.

| Opción | Qué hace | Por defecto |
|---|---|---|
| `dias` | Plazo de inactividad propio para ese rol | el general del servidor |
| `marcar` | Si se le pone `@Inactivo`. `false` = exento | `true` |
| `retirar` | Si **pierde ese rol** al quedar inactivo | `false` |
| `mensaje` | Texto de "cómo recuperarlo" que se le envía por MD al perderlo | mensaje genérico |
| `confirmar` | Obligatorio para **activar** `retirar` | — |

Las opciones omitidas **conservan su valor anterior**, así que se puede
cambiar una sola cosa sin repetir el resto.

```
/configurar rol rol:@Veterano dias:60 marcar:false
```

> **`retirar:true` exige confirmación.** Es la única opción con efecto masivo e
> irreversible de un golpe: mucha gente pierde el rol y recibe un MD. Al
> activarla sin `confirmar:true`, el bot **no guarda nada** y responde con
> cuántos miembros se verían afectados. Hay que repetir el comando con
> `confirmar:true` para aplicarlo.

```
/configurar rol rol:@Veterano retirar:true mensaje:Pide en #general que te lo devuelvan
   -> "Esto retirara Veterano a 15 miembros... nada se ha guardado"
/configurar rol rol:@Veterano retirar:true confirmar:true
```

Una vez activada, cambiar otras opciones de ese rol ya no vuelve a pedir
confirmación (el efecto masivo solo ocurre la primera vez).

> **Requisito para `retirar`**: el rol del bot debe estar **por encima** del rol
> a retirar en Ajustes → Roles. Si no, el comando lo rechaza explicando el
> problema en vez de guardar una política que fallaría en cada pasada.

Si un miembro tiene varios roles con política, gana el de **posición más alta**
en la jerarquía del servidor.

### `/configurar rol-quitar rol:<@rol>`

Elimina la política de un rol; sus miembros vuelven a las reglas generales.

## `/inactivos [dias]`

Lista los miembros del servidor sin actividad en voz durante más de `dias`
días.

- **Permiso requerido**: `Moderate Members` (Discord oculta el comando a
  quien no lo tenga).
- **Parámetros**:
  - `dias` (opcional, entero ≥ 1): umbral puntual. Si se omite, usa el
    configurado en el servidor con `/configurar`.
- **Salida**: embed con hasta 40 miembros ordenados de más a menos inactivo,
  cada uno con hace cuánto fue su última actividad de voz. Quien aparezca
  como _sin actividad de voz registrada_ no tiene ninguna fila en
  `voice_logs`: el bot nunca lo ha visto en voz, y por política eso cuenta
  como inactivo. Al pie se resume cuántos miembros tienen actividad reciente
  y cuántos están en período de gracia por llevar poco en el servidor.

Ejemplo:

```
/inactivos dias:45
```

## `/sincronizar-roles [dias]`

Fuerza una pasada de sincronización del rol `@Inactivo` sin esperar al ciclo
automático. Útil tras cambiar `DEFAULT_INACTIVE_DAYS` o para comprobar el
estado al momento.

- **Permiso requerido**: `Manage Roles`.
- **Parámetros**: `dias` (opcional, entero ≥ 1).
- **Respuesta**: efímera, con cuántos miembros se marcaron, desmarcaron y
  fallaron.

## `/moderar-inactivos accion [dias] [confirmar]`

Aplica una acción de moderación a los miembros inactivos.

> Discord exige que las opciones obligatorias se declaren antes que las
> opcionales, por eso `accion` va primero en la firma del comando.

- **Permiso requerido**: `Kick Members`.
- **Parámetros**:
  - `accion` (obligatorio): uno de
    - `rol` — asigna el rol `INACTIVE_ROLE_ID` (debe estar configurado en
      `.env` y el rol del bot debe estar por encima en la jerarquía).
    - `aviso` — envía un mensaje directo con el texto `INACTIVE_WARNING_MESSAGE`.
    - `expulsar` — expulsa (`kick`) al miembro del servidor. **Desactivado
      por defecto**: mientras `ALLOW_KICK` no sea `true` en el `.env`, esta
      acción se rechaza aunque se confirme.
  - `dias` (opcional, entero ≥ 1): umbral de inactividad.
  - `confirmar` (opcional, booleano, por defecto `false`): mientras sea
    `false`, el comando solo **simula** (dry-run) y muestra a quién
    afectaría, sin ejecutar nada.
- **Respuesta**: efímera (solo visible para quien ejecuta el comando).
- Cada ejecución real (`confirmar: true`) queda registrada en
  `moderation_actions` (ver [DATABASE.md](DATABASE.md)).

Ejemplo de flujo recomendado:

```
/moderar-inactivos accion:expulsar dias:60
# revisar la vista previa...
/moderar-inactivos accion:expulsar dias:60 confirmar:true
```

### Notas sobre fallos parciales

Si Discord rechaza la acción para algún miembro (p. ej. MDs cerrados, o el
bot sin permisos suficientes sobre un miembro con rol superior), esa
operación se cuenta en "Fallidos" y el resto continúa normalmente; los IDs
fallidos se listan en la respuesta.
