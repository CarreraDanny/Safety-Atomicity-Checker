# Práctica 1 – Verificador de consistencia (safety y atomicidad)

**Autor:** Danny Carrera
**Asignatura:** Sistemas Distribuidos, Empotrados y Ubicuos
**Ficheros:** `safe.js`, `atomic.js`, `pruebaD1.txt` … `pruebaD7.txt`, `eventos1.txt` … `eventos8.txt`
**Referencia:** W. Golab, X. Li, M. Shah, *Analyzing Consistency Properties for Fun and Profit*, PODC 2011 (Sección 3).

---

## 1. Objetivo

Construir programas que reciben una **historia de ejecución** de un almacén clave-valor (eventos de invocación y respuesta de `put` y `get`) y deciden si esa historia cumple una propiedad de consistencia. No se implementa el almacén: solo se comprueba lo que los clientes observaron.

Se piden dos verificadores:

1. **Consistencia segura (safety):** una lectura sin escrituras concurrentes devuelve el valor de la última escritura anterior; una lectura concurrente con alguna escritura puede devolver cualquier valor.
2. **Consistencia atómica (linealizabilidad):** existe un orden total de las operaciones, compatible con el orden real del tiempo, en el que cada lectura devuelve el valor de la última escritura anterior a ella.

La atomicidad es **más fuerte** que safety: toda historia atómica es segura, pero no al revés. Los resultados de esta práctica lo confirman (sección 6).

---

## 2. Modelo y formato de los datos

Cada línea del fichero de entrada es un evento JSON:

```json
{"tipo_e": "inv", "op":"put", "clave":"r1", "valor":"C1_1", "n":1, "id":"C1", "t":1}
{"tipo_e": "res", "op":"get", "clave":"r1", "valor":"C1_1", "n":1, "id":"C5", "t":5}
```

| Campo | Significado |
|---|---|
| `tipo_e` | `inv` (invocación) o `res` (respuesta) |
| `op` | `put` (escritura) o `get` (lectura) |
| `clave` | clave del almacén |
| `valor` | en un `put`, valor único `(id)_(n)`; en un `get`, `null` en la invocación y el valor leído en la respuesta |
| `n`, `id` | número de operación y cliente. `id_n` identifica la operación y permite emparejar su `inv` con su `res` |
| `t` | tiempo del evento |

Suposiciones del guion, que se cumplen en todos los ficheros usados:

- Los tiempos son distintos entre sí.
- **Cada escritura escribe un valor único**, de modo que dado el valor de una lectura se sabe qué escritura lo originó (*dictating write*).
- La historia se verifica **por clave**.

Una operación tiene tiempo de inicio `s` y de fin `f`. La operación `op` **precede** a `op'` si `op.f < op'.s`; si ninguna precede a la otra son **concurrentes**.

---

## 3. Verificador de safety (`safe.js`)

Implementa el Algoritmo 1 del artículo. Es **online**: lee el fichero línea a línea y emite `good` o `bad` por cada evento de **fin de lectura**. Solo estos eventos pueden ser `bad`, porque solo las lecturas revelan una violación a través del valor que devuelven.

### Estructuras

| Variable | En el artículo | Función |
|---|---|---|
| `nw` | `nw` | número de escrituras en curso |
| `reads` | `R` | lecturas pendientes (invocadas y sin respuesta) |
| `ignored` | `I` | lecturas concurrentes con alguna escritura, cuyo valor no se comprueba |
| `writes[valor]` | `w[a]` | valores permitidos, con tiempo de inicio `.s` y de fin `.t` de su escritura |

Las claves presentes en `writes` son los **valores permitidos**: los que aún podrían devolver lecturas actuales o futuras sin violar la propiedad.

### Qué hace con cada evento

| Evento | Acción |
|---|---|
| `put` + `inv` | `nw++`; las lecturas pendientes pasan a `ignored` (son concurrentes con esta escritura); se crea `writes[valor]` con su `.s` |
| `put` + `res` | `nw--`; se guarda `.t`; se descartan los valores cuya escritura terminó antes de que empezara ésta (`writes[key].t < writes[valor].s`) |
| `get` + `inv` | se añade a `reads`; si hay escrituras en curso (`nw > 0`) se añade también a `ignored` |
| `get` + `res` | se quita de `reads`. Si estaba en `ignored`: `good` sin comprobar nada. Si no: el valor debe existir en `writes` con la escritura terminada; si es así, `good` y se descartan los demás valores ya terminados; si no, **`bad`** |

### Bug encontrado y corregido

Al probar `pruebaD6.txt` el programa daba `good, good` cuando el resultado correcto es `good, bad`.

- **Causa:** el tiempo de fin de una escritura se guarda en `writes[valor].t`, pero la condición de descarte tras validar una lectura comprobaba `writes[key].f`, un campo que nunca se asigna. Como `undefined != undefined` es falso, esa rama nunca descartaba nada y un valor ya sustituido seguía considerándose permitido.
- **Corrección** (línea 47 de `safe.js`):

```js
// antes
if ( (key != event.valor) && (writes[key].f != undefined) )
// después
if ( (key != event.valor) && (writes[key].t != undefined) )
```

Con el arreglo, `pruebaD6` pasa de `good, good` a `good, bad`. Las demás pruebas y los `eventos1` a `eventos8` dan el mismo resultado con y sin él, así que `pruebaD6` es la que expone el fallo.

---

## 4. Verificador de atomicidad (`atomic.js`)

Implementa el algoritmo de Gibbons y Korach (GK) del artículo (Sección 3.4), en su versión **offline**: lee el fichero entero y da un veredicto por clave.

### Fundamento

- Un **cluster** es la escritura de un valor más todas las lecturas que lo devuelven.
- Para un valor `a`: `f(a)` es el **mínimo tiempo de fin** de sus operaciones y `s̄(a)` el **máximo tiempo de inicio**.
- La **zona** `Z(a)` es el intervalo entre ambos:
  - si `f(a) < s̄(a)` es **forward** y va de `f(a)` a `s̄(a)`;
  - si no, es **backward** y va de `s̄(a)` a `f(a)`.
- Dos zonas **conflictan** si:
  - ambas son forward y se solapan, o
  - una backward está contenida completamente en una forward.
  Dos backward nunca conflictan.
- **Teorema GK:** una historia es atómica si y solo si (1) toda lectura tiene escritura dictadora, (2) ninguna lectura precede a su escritura dictadora y (3) ningún par de zonas conflicta.

### Pasos del programa

1. Lee el fichero y descarta líneas vacías.
2. Empareja `inv` y `res` por `(id, n)` para formar operaciones con `s` y `f`, agrupadas por **clave**.
3. Para cada clave, localiza la escritura de cada valor y comprueba las condiciones (1) y (2).
4. Calcula el cluster, `f`, `s̄` y el tipo de zona de cada valor.
5. Comprueba todos los pares de zonas (condición 3).
6. Imprime las zonas y el resultado: `good (historia atomica)` o `bad (NO es atomica)` con el motivo.

El código de salida es `0` si la historia es atómica y `2` si no lo es (esto no genera ningún mensaje de error en PowerShell).

---

## 5. Cómo ejecutar

Desde la terminal de VS Code, en la carpeta de la práctica (requiere Node.js; se usó la v26.10.0):

```powershell
node safe.js pruebaD1.txt
node atomic.js pruebaD1.txt
```

Todas las pruebas con los dos verificadores:

```powershell
foreach ($i in 1..7) { "== pruebaD$i.txt"; "-- safe"; node safe.js "pruebaD$i.txt"; "-- atomic"; node atomic.js "pruebaD$i.txt" }
```

Los ocho ficheros del profesor:

```powershell
foreach ($i in 1..8) { "== eventos$i.txt"; "-- safe"; node safe.js "eventos$i.txt"; "-- atomic"; node atomic.js "eventos$i.txt" }
```

---

## 6. Pruebas y resultados

### 6.1 Pruebas propias

Todas usan la clave `d`. El resultado esperado se dedujo **antes** de ejecutar. Notación: `w(x)[a,b]` es una escritura del valor `x` con inicio `a` y fin `b`; `r→x[a,b]`, una lectura que devuelve `x`.

| Prueba | Historia | Qué comprueba |
|---|---|---|
| pruebaD1 | `w(C1_1)[1,2]`, `r→C1_1[3,4]` | lectura correcta sin concurrencia |
| pruebaD2 | `w(C1_1)[1,2]`, `w(C1_2)[3,4]`, `r→C1_1[5,6]` | valor sustituido leído sin concurrencia |
| pruebaD3 | `w(C1_1)[1,2]`, `w(C1_2)[3,6]`, `r→C9_9[4,5]` | lectura concurrente con valor arbitrario |
| pruebaD4 | `w(C1_1)[1,2]`, `r→C9_9[3,4]` | valor que nadie escribió |
| pruebaD5 | `w(C1_1)[1,2]`, `w(C1_2)[3,6]`, `r→C9_9[4,5]`, `r→C1_1[7,8]` | concurrente perdonada y posterior con valor viejo |
| pruebaD6 | `w(C1_1)[1,4]`, `w(C2_1)[2,5]`, `r→C1_1[6,7]`, `r→C2_1[8,9]` | escrituras concurrentes, lecturas incoherentes |
| pruebaD7 | `w(C1_1)[1,6]`, `r→C1_1[2,3]`, `w(C2_1)[4,9]`, `r→C2_1[5,7]` | dos zonas backward |

**Resultados** (con `safe.js` corregido):

| Prueba | Safety | Atomicidad | Zonas |
|---|---|---|---|
| pruebaD1 | `C2_1`: good | good | forward [2,3] |
| pruebaD2 | `C2_1`: **bad** | bad | forward [2,5], backward [3,4]: backward contenida |
| pruebaD3 | `C2_1`: good | bad | lectura de `C9_9` sin escritura dictadora |
| pruebaD4 | `C2_1`: **bad** | bad | lectura de `C9_9` sin escritura dictadora |
| pruebaD5 | `C2_1`: good, `C3_1`: **bad** | bad | forward [2,7], backward [3,6] contenida, y lectura de `C9_9` |
| pruebaD6 | `C3_1`: good, `C3_2`: **bad** | bad | forward [4,6] y forward [5,8] solapadas |
| pruebaD7 | `C3_1`: good, `C4_1`: good | good | backward [2,3] y backward [5,7] |

Observaciones:

- **`pruebaD3`** muestra que atomicidad es más estricta que safety: la lectura concurrente con una escritura se perdona en safety (puede devolver cualquier valor) pero en atomicidad devolver un valor que nadie escribió es una violación.
- **`pruebaD6`** es la que detecta el bug de la sección 3: antes del arreglo daba `good, good` en safety.
- **`pruebaD6`, `pruebaD7` y `pruebaD2`** son los ejemplos de los ejercicios 2a, 2b y 2c (ver `Apartado2_Graficos_Zonas.md`).

### 6.2 Ficheros del profesor (`eventos1` … `eventos8`)

Todos usan una única clave (`r1`).

| Fichero | Safety | Atomicidad | Zonas y motivo |
|---|---|---|---|
| eventos1 | 6 lecturas good | **good** | backward [2,4], forward [9,14] |
| eventos2 | 6 lecturas good | **bad** | forward [4,8] y [5,14] solapadas; además `C5_1` lee `C1_2` antes de que se invoque |
| eventos3 | `C6_1` y `C2_2`: bad; el resto good | **bad** | forward [4,14] contiene la backward [6,9] |
| eventos4 | 3 lecturas good | **good** | forward [2,3], backward [7,8], forward [9,10] |
| eventos5 | `C1_1`: bad; el resto good | **bad** | `C1_1` lee `C2_2` antes de que se invoque; forward [4,7], forward [9,10] |
| eventos6 | `C3_2`: bad; el resto good | **bad** | forward [2,10] contiene las backward [5,8] y [6,9] |
| eventos7 | 3 lecturas good | **bad** | forward [5,10] y [8,13] solapadas |
| eventos8 | 4 lecturas good | **bad** | forward [4,12] contiene la backward [6,11] |

### 6.3 Coherencia entre los dos verificadores

- Las historias **atómicas** (`eventos1`, `eventos4`, `pruebaD1`, `pruebaD7`) son también seguras: todas sus lecturas son `good`.
- Todas las historias en las que safety da `bad` (`eventos3`, `5`, `6`; `pruebaD2`, `D4`, `D5`, `D6`) son también `bad` en atomicidad.
- Hay historias seguras pero no atómicas (`eventos2`, `7`, `8`; `pruebaD3`), lo que confirma que atomicidad es la propiedad más fuerte.

---

## 7. Reutilización en el proyecto (Nota del guion)

El guion indica que el último algoritmo puede emplearse para verificar el protocolo de replicación activa del proyecto. `atomic.js` ya sirve para ello sin cambios, siempre que los clientes del proyecto registren sus eventos con el **mismo formato JSON** de la sección 2 (`tipo_e`, `op`, `clave`, `valor`, `n`, `id`, `t`), con valores de escritura únicos y tiempos distintos. Como `atomic.js` agrupa por clave, admite historias con varios registros.

---

## 8. Limitaciones

- `safe.js` ignora el campo `clave`: cada fichero debe contener una sola clave. Es el caso de todos los ficheros usados aquí, pero para historias con varias claves habría que filtrarlas antes o procesarlas por separado.
- Ninguno de los verificadores modela la escritura artificial inicial del artículo: una lectura que devolviera `null` antes de cualquier `put` se marcaría como violación.
- `atomic.js` es offline: necesita el fichero completo antes de dar el veredicto.
- Los ficheros no deben tener líneas vacías intermedias ni formato distinto al descrito (`safe.js` falla con `JSON.parse` ante una línea vacía).
- Se asume que los relojes de todos los clientes están sincronizados, como en el guion.
