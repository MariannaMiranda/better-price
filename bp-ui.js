/* bp-ui.js — UI for the relational features. Depends on bp-store.js. All strings are escaped via h().
 * v3: contextual "Share list" flow (openShareList), browse-first "Offers & coupons" tab, "Price history" wording (was "Price Book"),
 *     and the matching en/es/pt strings. Host may optionally provide goCompare() to jump to the Compare tab.
 * v2: calmer sync pill, "Lowest you've recorded" price-book copy, streamlined deal cards (also inline in the shopping list),
 *     and en/es/pt strings for every label in the Savings hub (see STR below).
 * Host contract (index.html): bp.ui.host.lang() returns 'en' | 'es' | 'pt'. Call bp.ui.relang() after a language change
 * and bp.ui.decorateList() after the grocery list re-renders. */
(function (global) {
  'use strict';
  const bp = global.bp;
  const ui = (bp.ui = { host: { activeListId: () => null, addItems: () => 0, fillCard: () => false, currency: () => '$', unitRates: () => ({}), preferredStores: () => [], accessToken: async () => null, lang: () => 'en' } });

  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const toast = (m, t) => bp.host.toast(m, t);
  const online = () => navigator.onLine !== false;

  /* ------------------------------ i18n ------------------------------ */
  // Every user-visible string in this file lives here. {name} placeholders are substituted by tr(); keys ending in
  // _one/_other are chosen by trn() using Intl.PluralRules. Missing es/pt keys fall back to English, never to a raw key.
  const LOCALES = { en: 'en-US', es: 'es-US', pt: 'pt-BR' };
  const STR = {
    en: {
      pill_synced: 'Synced', pill_synced_tip: 'All changes are synced.',
      pill_saved: 'Saved', pill_saved_tip: 'Saved on this device. Syncing shortly.',
      pill_saved_off: 'Saved on device',
      pill_saved_off_tip_one: "You're offline. {n} change is saved on this device and will sync when you reconnect.",
      pill_saved_off_tip_other: "You're offline. {n} changes are saved on this device and will sync when you reconnect.",
      pill_syncing: 'Syncing…', pill_syncing_tip: 'Syncing your changes…',
      pill_offline: 'Offline', pill_offline_tip: "You're offline. Changes are saved on this device.",
      pill_error: 'Sync paused · Retry',
      pill_error_tip_one: "{n} change hasn't synced yet. It's safe on this device. Tap to retry.",
      pill_error_tip_other: "{n} changes haven't synced yet. They're safe on this device. Tap to retry.",
      toast_synced: 'Everything is synced.', toast_offline: "You're offline. Changes are saved on this device.", toast_retrying: 'Retrying sync…',

      hub_tip: 'Savings: price history, offers, household', hub_aria: 'Savings hub',
      bar_replenish: 'Replenish', bar_share: 'Share list', bar_deals: 'Offers for this list',
      save_prices_btn: 'Save these prices to my price history',
      toast_alert: 'Good price: {name} hit {price}/{unit}', toast_alert_at: 'Good price: {name} at {store} hit {price}/{unit}',

      sheet_title: 'Savings', close: 'Close', tab_book: 'Price history', tab_deals: 'Offers & coupons', tab_house: 'Household',
      install_app: 'Install app', ios_install: 'Install on iPhone/iPad: tap Share, then Add to Home Screen.',
      loading: 'Loading…', err_generic: 'Something went wrong. Try again in a moment.', err_offline: 'You are offline. This section needs a connection.',

      pb_cached: 'Offline: showing your last saved price history.',
      alerts_one: '{n} good-price alert', alerts_other: '{n} good-price alerts', mark_read: 'Mark read',
      alert_row: '{name}: {price}/{unit} (target {target})', alert_row_at: '{name} at {store}: {price}/{unit} (target {target})',
      pb_empty_1: 'No price history yet.', pb_empty_2: 'Prices you save from a comparison will show up here.',
      pb_best: 'Best {price}/{unit}', pb_best_at: 'Best {price}/{unit} at {store}',
      meta_one: '{n} price recorded · last {date}', meta_other: '{n} prices recorded · last {date}',
      v_none: 'No data', v_target: 'At or below your target', v_new: 'Not enough history yet',
      v_lowest: "Lowest you've recorded", v_near: 'Close to your lowest',
      v_good: 'Good price (15%+ below your usual)', v_high: 'Higher than your usual', v_fair: 'In line with your usual',
      basis_one: 'Based on {n} price you recorded, most recent {date}.', basis_other: 'Based on {n} prices you recorded, most recent {date}.',
      basis_note: 'Only prices you and your household saved count. This is not store-wide data.',
      latest: 'latest {price}/{unit}', best_by_store: 'Best price by store', unknown_store: 'Unknown store',
      target_lbl: 'Alert me when it drops to (per {unit})', target_ph: 'e.g. {v}', target_aria: 'Target unit price',
      set_alert: 'Set alert', update: 'Update', remove: 'Remove',
      target_note: 'Alerts fire when any new price you (or your household) save is at or below this. No store data is fetched automatically.',
      history: 'Price history', del_price_aria: 'Delete this price',
      chart_need_two: 'Save at least two prices to see a trend.', chart_aria: 'Unit price history, {n} points, from {from} to {to}', chart_target: '- - your target',
      t_removed: 'Target removed', p_removed: 'Price history entry removed', t_invalid: 'Enter a target price greater than 0.', t_set: 'Alert set',

      sp_title: 'Save to price history', sp_name_first: 'Give each product a name first so it can be tracked.',
      sp_note: 'Only save prices you have confirmed on the shelf or receipt. Each one becomes a data point in your history.',
      store_ph: 'Store (optional)', store_aria: 'Store for {name}', share_with: 'Share with', just_me: 'Just me', hh_suffix: '{name} (household)',
      save_btn: 'Save prices', saved_one: 'Saved {n} price to your price history', saved_other: 'Saved {n} prices to your price history', nothing_sel: 'Nothing selected',

      lbl_matches: 'Matched to this list', lbl_add: 'Add a weekly-ad deal or coupon', lbl_active: 'Active deals', no_deals: 'No active deals yet.',
      ph_product: 'Product', ph_store: 'Store', ph_price: 'Shelf price', ph_size: 'Size per pack', ph_qty: 'Packs (default 1)',
      kind_ad: 'Weekly ad', kind_coupon: 'Coupon (needs clip)',
      disc_none: 'Sale price as listed', disc_p: '% off', disc_d: 'Amount off', disc_bogo: 'Buy X get Y free',
      ph_dv: 'Discount value / buy X', ph_get: 'Get Y (BOGO)', valid_until_aria: 'Valid until',
      add_note: 'Enter the shelf price and the discount separately; the effective unit price is calculated for you. No retailer feeds are used.',
      add_deal: 'Add deal', import_sum: 'Import a weekly ad (CSV)', import_cols: 'Columns: store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to',
      import_help: 'One deal per row. Required: product, kind (weekly_ad or coupon), price, size and unit. Store and quantity are optional; quantity defaults to 1. Discount fields (p, d or bogo) and valid_to are optional. A header row is optional; quote any value that contains a comma. Dates use YYYY-MM-DD. Up to 200 rows per import.',
      import_example: 'store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to\nPublix,Whole milk,weekly_ad,4.29,1,1,gal,,,,,',
      import_paste_ph: 'Paste CSV rows here (header row optional)',
      import_btn: 'Import',
      dc_ad: 'Weekly ad', dc_coupon: 'Coupon', dc_regular: 'Regular', dc_effective: 'effective', dc_per_pack: 'per pack',
      dc_unsupported: 'Unit not supported', dc_ends: 'Ends {date}', dc_ends_today: 'Ends today', dc_ends_tomorrow: 'Ends tomorrow',
      dc_best: 'Best deal', dc_clip_needed: 'Clip to use', dc_vs_best: 'Your best {price}/{unit}',
      dc_more_one: '+{n} more deal', dc_more_other: '+{n} more deals',
      compare: 'Compare', clip: 'Clip', unclip: 'Unclip', delete: 'Delete',
      how_p: '{v}% off', how_d: '{v} off', how_bogo: 'Buy {buy}, get {get} free', how_sale: 'Sale price', bogo_note: 'priced per full set',
      cmp_same: 'Same as your best', cmp_below: '{n}% below your best', cmp_above: '{n}% above your best',
      deal_added: 'Deal added', need_fields: 'Product, price and pack size are required.', need_dv: 'Enter the discount value.',
      pct_max: 'Percent off cannot exceed 100.', need_bogo: 'Enter how many to buy and how many are free.',
      imported_one: 'Imported {n} deal{skip}', imported_other: 'Imported {n} deals{skip}', skipped: ', skipped {n}',
      import_failed: 'Import failed.', sign_in_again: 'Please sign in again.',
      deal_on_card: 'Deal added to a comparison card', no_empty_card: 'No empty comparison card. Add a card first.',
      clipped: 'Coupon clipped', unclipped: 'Coupon unclipped',

      hh_intro: 'A household lets several people share lists, favorites and price history. Edits merge automatically, even from offline phones.',
      invite: 'Invite', invite_again: 'New code', leave: 'Leave', you: '(you)', owner: 'owner', member: 'member',
      invite_note: 'Invite code: valid for 7 days and up to 10 uses. Create a fresh code whenever your group needs another invite.',
      member_access: 'Members can edit shared-list items, but only the household owner can invite or remove members. Anyone can leave at any time.',
      hh_create_lbl: 'Create a household', hh_ph: 'e.g. Home', create: 'Create', join_lbl: 'Join with an invite code', code_ph: 'Invite code', join: 'Join',
      share_lbl: 'Who can see each of your lists', share_aria: 'Sharing for {name}', shared: 'List shared', private: 'List is private again',
      confirm_leave: 'Leave this household? Lists you own will become private and stay yours. You will lose access to lists owned by others.', confirm_kick: 'Remove this member?',
      e_invite: 'That invite code is invalid, expired or has no uses left. Ask the owner to create a fresh code.', e_full: 'That household is full.', e_limit: 'You have reached the household limit.',
      e_offline: 'You are offline.', e_generic: 'That did not work. Please try again.',
      need_hh_name: 'Give the household a name.', need_code: 'Enter the invite code.', hh_created: 'Household created', hh_joined: 'Joined. Shared lists are loading.',

      rep_title: 'Replenish', rep_open_list: 'Open a list first.', rep_note: 'Pinned and most-bought first. Items already on this list are hidden.',
      rep_bought: 'bought {n}× · last {date}', pin: 'Pin', unpin: 'Unpin', pin_aria: 'Pin {name}', unpin_aria: 'Unpin {name}', hide_aria: 'Hide {name}',
      rep_add: 'Add selected to list', rep_empty_1: 'Nothing to replenish yet.', rep_empty_2: 'Items you add to lists show up here for one-tap re-adding.',
      added_one: 'Added {n} item', added_other: 'Added {n} items',

      sh_title: 'Share this list',
      sh_chip_private: 'Private',
      sh_chip_shared: 'Shared',
      sh_status_private: 'Only you can see this list.',
      sh_status_shared: 'Shared with {name}.',
      sh_step1: 'Household',
      sh_step2: 'Share this list',
      sh_step3: 'Add people',
      sh_done: 'done',
      sh_hh_none: 'Lists are shared through a household: a group of people who see the same lists. Create one or join one to continue.',
      sh_create_btn: 'Create & share',
      sh_join_lbl: 'Join with a code',
      sh_share_btn: 'Share with {name}',
      sh_share_sel: 'Share this list',
      sh_need_hh: 'Create or join a household first.',
      sh_step2_done: 'Shared with {name}.',
      sh_invite_help: 'Create a code and send it. It is valid for 7 days and up to 10 uses; create a fresh code whenever your group needs another invite.',
      sh_invite_btn: 'Invite someone', sh_new_invite_btn: 'Create another code',
      sh_copy: 'Copy code',
      sh_send: 'Share…',
      sh_copied: 'Code copied',
      sh_copy_failed: 'Could not copy automatically. Select the code and copy it.',
      sh_invite_msg: 'Join my household on Better Price. Invite code: {code}',
      sh_invite_owner_only: 'Only the household owner can create invite codes.',
      sh_with_lbl: 'Shared with',
      sh_only_you: 'Only you so far. Invite someone to start sharing.',
      sh_stop: 'Stop sharing',
      sh_stop_confirm: 'Stop sharing this list? It will be private again.',
      sh_owner_only: 'You can edit items on this shared list, but only its owner can change sharing or delete the list.',
      sh_manage: 'Manage household & members',
      sh_created_shared: 'Household created. List shared.',
      offers_empty: 'No saved offers match this list yet. Offers are added by you or your household; live store ads aren\'t connected.',
      offers_scope_note: 'Offers are added by you or your household; live store ads aren\'t connected.',
      lbl_other: 'Other saved offers',
      lbl_all: 'All saved offers',
      act_add: 'Add an offer',
      act_import: 'Import CSV',
      more_opts: 'Discount, coupon & expiry (optional)',
      unit_aria: 'Size unit',
      ph_dv_p: 'Percent off (0–100)',
      ph_dv_d: 'Amount off',
      ph_dv_bogo: 'Buy how many?',
      pb_scope_note: 'Price history shows only prices you and your household recorded. It is not live store data.',
      pb_empty_cta: 'Save prices from a comparison',
      pb_go_compare: 'Compare some products, then tap "Save these prices to my price history".',
    },

    es: {
      pill_synced: 'Sincronizado', pill_synced_tip: 'Todos los cambios están sincronizados.',
      pill_saved: 'Guardado', pill_saved_tip: 'Guardado en este dispositivo. Se sincronizará en breve.',
      pill_saved_off: 'Guardado en el dispositivo',
      pill_saved_off_tip_one: 'Sin conexión. {n} cambio está guardado en este dispositivo y se sincronizará al reconectarte.',
      pill_saved_off_tip_other: 'Sin conexión. {n} cambios están guardados en este dispositivo y se sincronizarán al reconectarte.',
      pill_syncing: 'Sincronizando…', pill_syncing_tip: 'Sincronizando tus cambios…',
      pill_offline: 'Sin conexión', pill_offline_tip: 'Sin conexión. Los cambios se guardan en este dispositivo.',
      pill_error: 'Sincronización en pausa · Reintentar',
      pill_error_tip_one: 'Aún no se sincronizó {n} cambio. Está a salvo en este dispositivo. Toca para reintentar.',
      pill_error_tip_other: 'Aún no se sincronizaron {n} cambios. Están a salvo en este dispositivo. Toca para reintentar.',
      toast_synced: 'Todo está sincronizado.', toast_offline: 'Sin conexión. Los cambios se guardan en este dispositivo.', toast_retrying: 'Reintentando sincronizar…',

      hub_tip: 'Ahorros: historial de precios, ofertas, hogar', hub_aria: 'Centro de ahorros',
      bar_replenish: 'Reponer', bar_share: 'Compartir lista', bar_deals: 'Ofertas para esta lista',
      save_prices_btn: 'Guardar estos precios en mi historial de precios',
      toast_alert: 'Buen precio: {name} llegó a {price}/{unit}', toast_alert_at: 'Buen precio: {name} en {store} llegó a {price}/{unit}',

      sheet_title: 'Ahorros', close: 'Cerrar', tab_book: 'Historial de precios', tab_deals: 'Ofertas y cupones', tab_house: 'Hogar',
      install_app: 'Instalar app', ios_install: 'Instalar en iPhone/iPad: toca Compartir y luego Agregar a pantalla de inicio.',
      loading: 'Cargando…', err_generic: 'Algo salió mal. Inténtalo de nuevo en un momento.', err_offline: 'Estás sin conexión. Esta sección necesita conexión.',

      pb_cached: 'Sin conexión: mostrando tu último historial de precios guardado.',
      alerts_one: '{n} alerta de buen precio', alerts_other: '{n} alertas de buen precio', mark_read: 'Marcar como leídas',
      alert_row: '{name}: {price}/{unit} (meta {target})', alert_row_at: '{name} en {store}: {price}/{unit} (meta {target})',
      pb_empty_1: 'Aún no hay historial de precios.', pb_empty_2: 'Los precios que guardes desde una comparación aparecerán aquí.',
      pb_best: 'Mejor {price}/{unit}', pb_best_at: 'Mejor {price}/{unit} en {store}',
      meta_one: '{n} precio registrado · último {date}', meta_other: '{n} precios registrados · último {date}',
      v_none: 'Sin datos', v_target: 'En tu meta o por debajo', v_new: 'Aún no hay suficiente historial',
      v_lowest: 'El más bajo que has registrado', v_near: 'Cerca de tu mínimo',
      v_good: 'Buen precio (15% o más debajo de lo habitual)', v_high: 'Más alto de lo habitual', v_fair: 'En línea con lo habitual',
      basis_one: 'Basado en {n} precio que registraste, el más reciente {date}.', basis_other: 'Basado en {n} precios que registraste, el más reciente {date}.',
      basis_note: 'Solo cuentan los precios que tú y tu hogar guardaron. No son datos de todas las tiendas.',
      latest: 'último {price}/{unit}', best_by_store: 'Mejor precio por tienda', unknown_store: 'Tienda desconocida',
      target_lbl: 'Avísame cuando baje a (por {unit})', target_ph: 'p. ej. {v}', target_aria: 'Precio unitario meta',
      set_alert: 'Crear alerta', update: 'Actualizar', remove: 'Quitar',
      target_note: 'Las alertas se activan cuando cualquier precio nuevo que tú (o tu hogar) guarden sea igual o menor. No se consultan datos de tiendas automáticamente.',
      history: 'Historial de precios', del_price_aria: 'Eliminar este precio',
      chart_need_two: 'Guarda al menos dos precios para ver una tendencia.', chart_aria: 'Historial de precio unitario, {n} puntos, de {from} a {to}', chart_target: '- - tu meta',
      t_removed: 'Meta eliminada', p_removed: 'Se eliminó el registro del historial de precios', t_invalid: 'Ingresa un precio meta mayor que 0.', t_set: 'Alerta creada',

      sp_title: 'Guardar en el historial de precios', sp_name_first: 'Ponle nombre a cada producto para poder darle seguimiento.',
      sp_note: 'Guarda solo precios que hayas confirmado en el estante o en el recibo. Cada uno se convierte en un dato de tu historial.',
      store_ph: 'Tienda (opcional)', store_aria: 'Tienda para {name}', share_with: 'Compartir con', just_me: 'Solo yo', hh_suffix: '{name} (hogar)',
      save_btn: 'Guardar precios', saved_one: 'Se guardó {n} precio en tu historial de precios', saved_other: 'Se guardaron {n} precios en tu historial de precios', nothing_sel: 'No seleccionaste nada',

      lbl_matches: 'Coinciden con esta lista', lbl_add: 'Agrega una oferta del folleto o un cupón', lbl_active: 'Ofertas activas', no_deals: 'Aún no hay ofertas activas.',
      ph_product: 'Producto', ph_store: 'Tienda', ph_price: 'Precio en estante', ph_size: 'Tamaño por paquete', ph_qty: 'Paquetes (predeterminado 1)',
      kind_ad: 'Folleto semanal', kind_coupon: 'Cupón (hay que activarlo)',
      disc_none: 'Precio de oferta tal como aparece', disc_p: '% de descuento', disc_d: 'Monto de descuento', disc_bogo: 'Compra X y lleva Y gratis',
      ph_dv: 'Valor del descuento / compra X', ph_get: 'Lleva Y (2x1)', valid_until_aria: 'Válido hasta',
      add_note: 'Ingresa por separado el precio en estante y el descuento; el precio unitario efectivo se calcula por ti. No se usan datos de minoristas.',
      add_deal: 'Agregar oferta', import_sum: 'Importar un folleto semanal (CSV)', import_cols: 'Columnas: store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to',
      import_help: 'Una oferta por fila. Obligatorios: product, kind (weekly_ad o coupon), price, size y unit. store y quantity son opcionales; quantity predeterminada es 1. El descuento (p, d o bogo) y valid_to son opcionales. El encabezado es opcional; usa comillas si un valor contiene comas. Fechas en formato YYYY-MM-DD. Máximo 200 filas por importación.',
      import_example: 'store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to\nPublix,Whole milk,weekly_ad,4.29,1,1,gal,,,,,',
      import_paste_ph: 'Pega aquí las filas CSV (encabezado opcional)',
      import_btn: 'Importar',
      dc_ad: 'Folleto semanal', dc_coupon: 'Cupón', dc_regular: 'Regular', dc_effective: 'efectivo', dc_per_pack: 'por paquete',
      dc_unsupported: 'Unidad no compatible', dc_ends: 'Termina {date}', dc_ends_today: 'Termina hoy', dc_ends_tomorrow: 'Termina mañana',
      dc_best: 'Mejor oferta', dc_clip_needed: 'Actívalo para usarlo', dc_vs_best: 'Tu mejor {price}/{unit}',
      dc_more_one: '+{n} oferta más', dc_more_other: '+{n} ofertas más',
      compare: 'Comparar', clip: 'Activar', unclip: 'Desactivar', delete: 'Eliminar',
      how_p: '{v}% de descuento', how_d: '{v} de descuento', how_bogo: 'Compra {buy}, lleva {get} gratis', how_sale: 'Precio de oferta', bogo_note: 'precio por juego completo',
      cmp_same: 'Igual a tu mejor precio', cmp_below: '{n}% menos que tu mejor precio', cmp_above: '{n}% más que tu mejor precio',
      deal_added: 'Oferta agregada', need_fields: 'Se requieren el producto, el precio y el tamaño del paquete.', need_dv: 'Ingresa el valor del descuento.',
      pct_max: 'El porcentaje de descuento no puede superar 100.', need_bogo: 'Ingresa cuántos comprar y cuántos son gratis.',
      imported_one: 'Se importó {n} oferta{skip}', imported_other: 'Se importaron {n} ofertas{skip}', skipped: ', {n} omitidas',
      import_failed: 'Falló la importación.', sign_in_again: 'Inicia sesión de nuevo.',
      deal_on_card: 'Oferta agregada a una tarjeta de comparación', no_empty_card: 'No hay una tarjeta de comparación vacía. Agrega una tarjeta primero.',
      clipped: 'Cupón activado', unclipped: 'Cupón desactivado',

      hh_intro: 'Un hogar permite que varias personas compartan listas, favoritos e historial de precios. Los cambios se combinan solos, incluso desde teléfonos sin conexión.',
      invite: 'Invitar', invite_again: 'Nuevo código', leave: 'Salir', you: '(tú)', owner: 'propietario', member: 'miembro',
      invite_note: 'Código válido por 7 días y hasta 10 usos. Crea un código nuevo cuando tu grupo necesite otra invitación.',
      member_access: 'Los miembros pueden editar artículos de listas compartidas, pero solo el propietario del hogar puede invitar o quitar miembros. Cualquiera puede salir cuando quiera.',
      hh_create_lbl: 'Crear un hogar', hh_ph: 'p. ej. Casa', create: 'Crear', join_lbl: 'Unirse con un código de invitación', code_ph: 'Código de invitación', join: 'Unirme',
      share_lbl: 'Quién puede ver cada una de tus listas', share_aria: 'Uso compartido de {name}', shared: 'Lista compartida', private: 'La lista vuelve a ser privada',
      confirm_leave: '¿Salir de este hogar? Tus listas volverán a ser privadas y seguirán siendo tuyas. Perderás acceso a las listas de otras personas.', confirm_kick: '¿Quitar a este miembro?',
      e_invite: 'El código no es válido, venció o ya no tiene usos. Pide al propietario que cree uno nuevo.', e_full: 'Ese hogar está lleno.', e_limit: 'Alcanzaste el límite de hogares.',
      e_offline: 'Estás sin conexión.', e_generic: 'No funcionó. Inténtalo de nuevo.',
      need_hh_name: 'Ponle un nombre al hogar.', need_code: 'Ingresa el código de invitación.', hh_created: 'Hogar creado', hh_joined: 'Te uniste. Se están cargando las listas compartidas.',

      rep_title: 'Reponer', rep_open_list: 'Abre una lista primero.', rep_note: 'Primero los fijados y los más comprados. Los artículos que ya están en esta lista se ocultan.',
      rep_bought: 'comprado {n}× · último {date}', pin: 'Fijar', unpin: 'Quitar fijado', pin_aria: 'Fijar {name}', unpin_aria: 'Quitar fijado de {name}', hide_aria: 'Ocultar {name}',
      rep_add: 'Agregar seleccionados a la lista', rep_empty_1: 'Aún no hay nada que reponer.', rep_empty_2: 'Los artículos que agregues a tus listas aparecerán aquí para volver a agregarlos con un toque.',
      added_one: 'Se agregó {n} artículo', added_other: 'Se agregaron {n} artículos',

      sh_title: 'Compartir esta lista',
      sh_chip_private: 'Privada',
      sh_chip_shared: 'Compartida',
      sh_status_private: 'Solo tú puedes ver esta lista.',
      sh_status_shared: 'Compartida con {name}.',
      sh_step1: 'Hogar',
      sh_step2: 'Compartir esta lista',
      sh_step3: 'Agregar personas',
      sh_done: 'hecho',
      sh_hh_none: 'Las listas se comparten mediante un hogar: un grupo de personas que ven las mismas listas. Crea uno o únete a uno para continuar.',
      sh_create_btn: 'Crear y compartir',
      sh_join_lbl: 'Unirse con un código',
      sh_share_btn: 'Compartir con {name}',
      sh_share_sel: 'Compartir esta lista',
      sh_need_hh: 'Primero crea un hogar o únete a uno.',
      sh_step2_done: 'Compartida con {name}.',
      sh_invite_help: 'Crea un código y envíaselo. Es válido por 7 días y hasta 10 usos; crea otro cuando tu grupo necesite una nueva invitación.',
      sh_invite_btn: 'Invitar a alguien', sh_new_invite_btn: 'Crear otro código',
      sh_copy: 'Copiar código',
      sh_send: 'Compartir…',
      sh_copied: 'Código copiado',
      sh_copy_failed: 'No se pudo copiar automáticamente. Selecciona el código y cópialo.',
      sh_invite_msg: 'Únete a mi hogar en Better Price. Código de invitación: {code}',
      sh_invite_owner_only: 'Solo el propietario del hogar puede crear códigos de invitación.',
      sh_with_lbl: 'Compartida con',
      sh_only_you: 'Por ahora solo tú. Invita a alguien para empezar a compartir.',
      sh_stop: 'Dejar de compartir',
      sh_stop_confirm: '¿Dejar de compartir esta lista? Volverá a ser privada.',
      sh_owner_only: 'Puedes editar artículos de esta lista compartida, pero solo su propietario puede cambiar el uso compartido o eliminarla.',
      sh_manage: 'Administrar hogar y miembros',
      sh_created_shared: 'Hogar creado. Lista compartida.',
      offers_empty: 'Todavía no hay ofertas guardadas que coincidan con esta lista. Las ofertas las agregas tú o tu hogar; los folletos de las tiendas en vivo no están conectados.',
      offers_scope_note: 'Las ofertas las agregas tú o tu hogar; los folletos de las tiendas en vivo no están conectados.',
      lbl_other: 'Otras ofertas guardadas',
      lbl_all: 'Todas las ofertas guardadas',
      act_add: 'Agregar una oferta',
      act_import: 'Importar CSV',
      more_opts: 'Descuento, cupón y vencimiento (opcional)',
      unit_aria: 'Unidad del tamaño',
      ph_dv_p: 'Porcentaje de descuento (0–100)',
      ph_dv_d: 'Monto de descuento',
      ph_dv_bogo: '¿Cuántos comprar?',
      pb_scope_note: 'El historial de precios solo muestra los precios que tú y tu hogar registraron. No son datos en vivo de las tiendas.',
      pb_empty_cta: 'Guardar precios desde una comparación',
      pb_go_compare: 'Compara algunos productos y luego toca "Guardar estos precios en mi historial de precios".',
    },

    pt: {
      pill_synced: 'Sincronizado', pill_synced_tip: 'Todas as alterações estão sincronizadas.',
      pill_saved: 'Salvo', pill_saved_tip: 'Salvo neste aparelho. Sincronizando em instantes.',
      pill_saved_off: 'Salvo no aparelho',
      pill_saved_off_tip_one: 'Você está offline. {n} alteração está salva neste aparelho e será sincronizada quando você reconectar.',
      pill_saved_off_tip_other: 'Você está offline. {n} alterações estão salvas neste aparelho e serão sincronizadas quando você reconectar.',
      pill_syncing: 'Sincronizando…', pill_syncing_tip: 'Sincronizando suas alterações…',
      pill_offline: 'Offline', pill_offline_tip: 'Você está offline. As alterações ficam salvas neste aparelho.',
      pill_error: 'Sincronização pausada · Tentar de novo',
      pill_error_tip_one: '{n} alteração ainda não foi sincronizada. Ela está segura neste aparelho. Toque para tentar de novo.',
      pill_error_tip_other: '{n} alterações ainda não foram sincronizadas. Elas estão seguras neste aparelho. Toque para tentar de novo.',
      toast_synced: 'Tudo está sincronizado.', toast_offline: 'Você está offline. As alterações ficam salvas neste aparelho.', toast_retrying: 'Tentando sincronizar de novo…',

      hub_tip: 'Economia: histórico de preços, ofertas, família', hub_aria: 'Central de economia',
      bar_replenish: 'Repor', bar_share: 'Compartilhar lista', bar_deals: 'Ofertas para esta lista',
      save_prices_btn: 'Salvar estes preços no meu histórico de preços',
      toast_alert: 'Bom preço: {name} chegou a {price}/{unit}', toast_alert_at: 'Bom preço: {name} em {store} chegou a {price}/{unit}',

      sheet_title: 'Economia', close: 'Fechar', tab_book: 'Histórico de preços', tab_deals: 'Ofertas e cupons', tab_house: 'Família',
      install_app: 'Instalar app', ios_install: 'Instalar no iPhone/iPad: toque em Compartilhar e depois em Adicionar à Tela de Início.',
      loading: 'Carregando…', err_generic: 'Algo deu errado. Tente de novo em instantes.', err_offline: 'Você está offline. Esta seção precisa de conexão.',

      pb_cached: 'Offline: mostrando seu último histórico de preços salvo.',
      alerts_one: '{n} alerta de bom preço', alerts_other: '{n} alertas de bom preço', mark_read: 'Marcar como lidos',
      alert_row: '{name}: {price}/{unit} (meta {target})', alert_row_at: '{name} em {store}: {price}/{unit} (meta {target})',
      pb_empty_1: 'Ainda não há histórico de preços.', pb_empty_2: 'Os preços que você salvar a partir de uma comparação aparecerão aqui.',
      pb_best: 'Melhor {price}/{unit}', pb_best_at: 'Melhor {price}/{unit} em {store}',
      meta_one: '{n} preço registrado · último {date}', meta_other: '{n} preços registrados · último {date}',
      v_none: 'Sem dados', v_target: 'Na sua meta ou abaixo', v_new: 'Ainda não há histórico suficiente',
      v_lowest: 'O menor que você já registrou', v_near: 'Perto do seu menor preço',
      v_good: 'Bom preço (15% ou mais abaixo do seu habitual)', v_high: 'Mais alto que o seu habitual', v_fair: 'Dentro do seu habitual',
      basis_one: 'Com base em {n} preço que você registrou, o mais recente em {date}.', basis_other: 'Com base em {n} preços que você registrou, o mais recente em {date}.',
      basis_note: 'Só contam os preços que você e sua família salvaram. Não são dados de todos os mercados.',
      latest: 'último {price}/{unit}', best_by_store: 'Melhor preço por loja', unknown_store: 'Loja desconhecida',
      target_lbl: 'Avise-me quando cair para (por {unit})', target_ph: 'ex.: {v}', target_aria: 'Preço unitário desejado',
      set_alert: 'Criar alerta', update: 'Atualizar', remove: 'Remover',
      target_note: 'Os alertas disparam quando qualquer preço novo que você (ou sua família) salvar for igual ou menor. Nenhum dado de loja é buscado automaticamente.',
      history: 'Histórico de preços', del_price_aria: 'Excluir este preço',
      chart_need_two: 'Salve pelo menos dois preços para ver uma tendência.', chart_aria: 'Histórico de preço unitário, {n} pontos, de {from} a {to}', chart_target: '- - sua meta',
      t_removed: 'Meta removida', p_removed: 'Registro do histórico de preços removido', t_invalid: 'Informe um preço desejado maior que 0.', t_set: 'Alerta criado',

      sp_title: 'Salvar no histórico de preços', sp_name_first: 'Dê um nome a cada produto para poder acompanhá-lo.',
      sp_note: 'Salve apenas preços que você confirmou na prateleira ou no recibo. Cada um vira um ponto no seu histórico.',
      store_ph: 'Loja (opcional)', store_aria: 'Loja para {name}', share_with: 'Compartilhar com', just_me: 'Só eu', hh_suffix: '{name} (família)',
      save_btn: 'Salvar preços', saved_one: 'Salvou {n} preço no seu histórico de preços', saved_other: 'Salvou {n} preços no seu histórico de preços', nothing_sel: 'Nada selecionado',

      lbl_matches: 'Correspondem a esta lista', lbl_add: 'Adicione uma oferta do encarte ou um cupom', lbl_active: 'Ofertas ativas', no_deals: 'Ainda não há ofertas ativas.',
      ph_product: 'Produto', ph_store: 'Loja', ph_price: 'Preço na prateleira', ph_size: 'Tamanho por pacote', ph_qty: 'Pacotes (padrão 1)',
      kind_ad: 'Encarte semanal', kind_coupon: 'Cupom (precisa ativar)',
      disc_none: 'Preço promocional como anunciado', disc_p: '% de desconto', disc_d: 'Valor de desconto', disc_bogo: 'Leve X e ganhe Y grátis',
      ph_dv: 'Valor do desconto / leve X', ph_get: 'Ganhe Y (leve+ganhe)', valid_until_aria: 'Válido até',
      add_note: 'Informe o preço da prateleira e o desconto separadamente; o preço unitário efetivo é calculado para você. Nenhum feed de varejista é usado.',
      add_deal: 'Adicionar oferta', import_sum: 'Importar um encarte semanal (CSV)', import_cols: 'Colunas: store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to',
      import_help: 'Uma oferta por linha. Obrigatórios: product, kind (weekly_ad ou coupon), price, size e unit. store e quantity são opcionais; quantity padrão é 1. Desconto (p, d ou bogo) e valid_to são opcionais. O cabeçalho é opcional; use aspas se um valor tiver vírgula. Datas no formato YYYY-MM-DD. Até 200 linhas por importação.',
      import_example: 'store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to\nPublix,Whole milk,weekly_ad,4.29,1,1,gal,,,,,',
      import_paste_ph: 'Cole as linhas CSV aqui (cabeçalho opcional)',
      import_btn: 'Importar',
      dc_ad: 'Encarte semanal', dc_coupon: 'Cupom', dc_regular: 'Normal', dc_effective: 'efetivo', dc_per_pack: 'por pacote',
      dc_unsupported: 'Unidade não compatível', dc_ends: 'Termina {date}', dc_ends_today: 'Termina hoje', dc_ends_tomorrow: 'Termina amanhã',
      dc_best: 'Melhor oferta', dc_clip_needed: 'Ative para usar', dc_vs_best: 'Seu melhor {price}/{unit}',
      dc_more_one: '+{n} oferta a mais', dc_more_other: '+{n} ofertas a mais',
      compare: 'Comparar', clip: 'Ativar', unclip: 'Desativar', delete: 'Excluir',
      how_p: '{v}% de desconto', how_d: '{v} de desconto', how_bogo: 'Leve {buy}, ganhe {get} grátis', how_sale: 'Preço promocional', bogo_note: 'preço por conjunto completo',
      cmp_same: 'Igual ao seu melhor preço', cmp_below: '{n}% abaixo do seu melhor preço', cmp_above: '{n}% acima do seu melhor preço',
      deal_added: 'Oferta adicionada', need_fields: 'Produto, preço e tamanho do pacote são obrigatórios.', need_dv: 'Informe o valor do desconto.',
      pct_max: 'O desconto percentual não pode passar de 100.', need_bogo: 'Informe quantos levar e quantos são grátis.',
      imported_one: '{n} oferta importada{skip}', imported_other: '{n} ofertas importadas{skip}', skipped: ', {n} ignoradas',
      import_failed: 'Falha na importação.', sign_in_again: 'Entre novamente.',
      deal_on_card: 'Oferta adicionada a um cartão de comparação', no_empty_card: 'Não há cartão de comparação vazio. Adicione um cartão primeiro.',
      clipped: 'Cupom ativado', unclipped: 'Cupom desativado',

      hh_intro: 'Uma família permite que várias pessoas compartilhem listas, favoritos e histórico de preços. As edições se combinam sozinhas, até de celulares offline.',
      invite: 'Convidar', invite_again: 'Novo código', leave: 'Sair', you: '(você)', owner: 'dono', member: 'membro',
      invite_note: 'Código válido por 7 dias e até 10 usos. Crie um novo código quando seu grupo precisar de outro convite.',
      member_access: 'Membros podem editar itens das listas compartilhadas, mas só o dono da família pode convidar ou remover membros. Qualquer pessoa pode sair quando quiser.',
      hh_create_lbl: 'Criar uma família', hh_ph: 'ex.: Casa', create: 'Criar', join_lbl: 'Entrar com um código de convite', code_ph: 'Código de convite', join: 'Entrar',
      share_lbl: 'Quem pode ver cada uma das suas listas', share_aria: 'Compartilhamento de {name}', shared: 'Lista compartilhada', private: 'A lista voltou a ser privada',
      confirm_leave: 'Sair desta família? Suas listas voltarão a ser privadas e continuarão sendo suas. Você perderá acesso às listas de outras pessoas.', confirm_kick: 'Remover este membro?',
      e_invite: 'O código é inválido, expirou ou não tem mais usos. Peça ao dono para criar um novo.', e_full: 'Essa família está cheia.', e_limit: 'Você atingiu o limite de famílias.',
      e_offline: 'Você está offline.', e_generic: 'Não funcionou. Tente novamente.',
      need_hh_name: 'Dê um nome à família.', need_code: 'Informe o código de convite.', hh_created: 'Família criada', hh_joined: 'Você entrou. As listas compartilhadas estão carregando.',

      rep_title: 'Repor', rep_open_list: 'Abra uma lista primeiro.', rep_note: 'Fixados e mais comprados primeiro. Itens que já estão nesta lista ficam ocultos.',
      rep_bought: 'comprado {n}× · último {date}', pin: 'Fixar', unpin: 'Desafixar', pin_aria: 'Fixar {name}', unpin_aria: 'Desafixar {name}', hide_aria: 'Ocultar {name}',
      rep_add: 'Adicionar selecionados à lista', rep_empty_1: 'Nada para repor ainda.', rep_empty_2: 'Os itens que você adiciona às listas aparecem aqui para readicionar com um toque.',
      added_one: '{n} item adicionado', added_other: '{n} itens adicionados',

      sh_title: 'Compartilhar esta lista',
      sh_chip_private: 'Privada',
      sh_chip_shared: 'Compartilhada',
      sh_status_private: 'Só você pode ver esta lista.',
      sh_status_shared: 'Compartilhada com {name}.',
      sh_step1: 'Família',
      sh_step2: 'Compartilhar esta lista',
      sh_step3: 'Adicionar pessoas',
      sh_done: 'concluído',
      sh_hh_none: 'As listas são compartilhadas por meio de uma família: um grupo de pessoas que veem as mesmas listas. Crie uma ou entre em uma para continuar.',
      sh_create_btn: 'Criar e compartilhar',
      sh_join_lbl: 'Entrar com um código',
      sh_share_btn: 'Compartilhar com {name}',
      sh_share_sel: 'Compartilhar esta lista',
      sh_need_hh: 'Primeiro crie uma família ou entre em uma.',
      sh_step2_done: 'Compartilhada com {name}.',
      sh_invite_help: 'Crie um código e envie. Ele vale por 7 dias e até 10 usos; crie outro quando seu grupo precisar de um novo convite.',
      sh_invite_btn: 'Convidar alguém', sh_new_invite_btn: 'Criar outro código',
      sh_copy: 'Copiar código',
      sh_send: 'Compartilhar…',
      sh_copied: 'Código copiado',
      sh_copy_failed: 'Não foi possível copiar automaticamente. Selecione o código e copie.',
      sh_invite_msg: 'Entre na minha família no Better Price. Código de convite: {code}',
      sh_invite_owner_only: 'Só o dono da família pode criar códigos de convite.',
      sh_with_lbl: 'Compartilhada com',
      sh_only_you: 'Por enquanto só você. Convide alguém para começar a compartilhar.',
      sh_stop: 'Parar de compartilhar',
      sh_stop_confirm: 'Parar de compartilhar esta lista? Ela voltará a ser privada.',
      sh_owner_only: 'Você pode editar os itens desta lista compartilhada, mas só o dono pode alterar o compartilhamento ou excluí-la.',
      sh_manage: 'Gerenciar família e membros',
      sh_created_shared: 'Família criada. Lista compartilhada.',
      offers_empty: 'Ainda não há ofertas salvas que correspondam a esta lista. As ofertas são adicionadas por você ou pela sua família; os encartes das lojas ao vivo não estão conectados.',
      offers_scope_note: 'As ofertas são adicionadas por você ou pela sua família; os encartes das lojas ao vivo não estão conectados.',
      lbl_other: 'Outras ofertas salvas',
      lbl_all: 'Todas as ofertas salvas',
      act_add: 'Adicionar uma oferta',
      act_import: 'Importar CSV',
      more_opts: 'Desconto, cupom e validade (opcional)',
      unit_aria: 'Unidade do tamanho',
      ph_dv_p: 'Porcentagem de desconto (0–100)',
      ph_dv_d: 'Valor do desconto',
      ph_dv_bogo: 'Quantos comprar?',
      pb_scope_note: 'O histórico de preços mostra apenas os preços que você e sua família registraram. Não são dados ao vivo das lojas.',
      pb_empty_cta: 'Salvar preços de uma comparação',
      pb_go_compare: 'Compare alguns produtos e toque em "Salvar estes preços no meu histórico de preços".',
    },
  };
  const curLang = () => { const l = (ui.host.lang && ui.host.lang()) || 'en'; return STR[l] ? l : 'en'; };
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
  const tr = (k, v) => { const L = STR[curLang()]; return fill(L[k] != null ? L[k] : STR.en[k] != null ? STR.en[k] : k, v); };
  const trn = (k, n, v) => {                                  // plural-aware: looks up k_one / k_other
    let cat = 'other'; try { cat = new Intl.PluralRules(LOCALES[curLang()]).select(n) === 'one' ? 'one' : 'other'; } catch (e) { cat = n === 1 ? 'one' : 'other'; }
    return tr(k + '_' + cat, Object.assign({ n }, v));
  };
  ui._STR = STR;                                              // exposed for tests / key-parity checks

  const money = (n, cur) => `${cur || '$'}${(+n).toFixed(+n < 1 ? 4 : 3)}`;
  const money2 = (n, cur) => `${cur || '$'}${(+n).toFixed(2)}`;
  const fmtDate = d => { try { return new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString(LOCALES[curLang()], { month: 'short', day: 'numeric' }); } catch (e) { return d; } };
  const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // local day, not UTC

  const CSS = `
  /* ---- sync pill ---- */
  .bpx-pill{display:none;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:rgba(255,255,255,.92);font:600 12px var(--font,system-ui);padding:5px 9px;border-radius:999px;cursor:pointer;margin-right:6px;white-space:nowrap;transition:background .2s,border-color .2s,gap .3s}
  .bpx-pill.on{display:inline-flex}.bpx-pill:hover{background:rgba(255,255,255,.14)}.bpx-pill:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}
  .bpx-ic{width:14px;height:14px;flex:none;display:block}.bpx-ic *{display:none}
  .bpx-pill[data-s=synced] .s-synced,.bpx-pill[data-s=saved] .s-saved,.bpx-pill[data-s=syncing] .s-syncing,.bpx-pill[data-s=offline] .s-offline,.bpx-pill[data-s=error] .s-error{display:inline}
  .bpx-pill[data-s=syncing] .bpx-ic{animation:bpxs .9s linear infinite}
  .bpx-pill[data-s=error]{background:rgba(239,68,68,.2);border-color:rgba(248,113,113,.6)}
  .bpx-t{display:inline-block;max-width:240px;overflow:hidden;opacity:1;transition:max-width .35s ease,opacity .25s ease}
  .bpx-pill.quiet{gap:0}.bpx-pill.quiet .bpx-t{max-width:0;opacity:0}
  .bpx-pill.quiet:hover,.bpx-pill.quiet:focus-visible,.bpx-pill.peek{gap:6px}
  .bpx-pill.quiet:hover .bpx-t,.bpx-pill.quiet:focus-visible .bpx-t,.bpx-pill.peek .bpx-t{max-width:240px;opacity:1}
  .bpx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  @keyframes bpxs{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.bpx-pill[data-s=syncing] .bpx-ic{animation:none}.bpx-t,.bpx-pill{transition:none}}
  @media (max-width:520px){.bpx-pill:not([data-s=error]) .bpx-t{display:none}}
  /* ---- hub ---- */
  .bpx-hubbtn{position:relative;display:none;background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;padding:4px 8px}.bpx-hubbtn.on{display:inline-flex}
  .bpx-hubbtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .bpx-badge{position:absolute;top:-2px;right:0;background:#ef4444;color:#fff;font:700 10px var(--font,system-ui);min-width:16px;height:16px;border-radius:8px;display:none;align-items:center;justify-content:center;padding:0 4px}
  .bpx-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-end;justify-content:center}
  .bpx-sheet{background:var(--card-bg,var(--white,#fff));color:var(--text);width:100%;max-width:640px;max-height:92vh;max-height:92dvh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.3)}
  @media (min-width:700px){.bpx-ov{align-items:center}.bpx-sheet{border-radius:18px;max-height:86vh;max-height:86dvh}}
  .bpx-hd{display:flex;align-items:center;gap:8px;padding:14px 16px 8px}.bpx-hd h2{flex:1;font-size:17px;margin:0}
  .bpx-x{background:var(--input-bg);border:1px solid var(--border);color:var(--text);width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px}
  .bpx-tabs{display:flex;gap:4px;padding:0 12px 8px;border-bottom:1px solid var(--border)}
  .bpx-tab{flex:1;background:none;border:none;color:var(--muted);font:600 13px var(--font,system-ui);padding:9px 6px;border-radius:9px;cursor:pointer}.bpx-tab[aria-selected=true]{background:var(--input-bg);color:var(--text)}
  @media (hover:none),(pointer:coarse){.bpx-x{width:44px;height:44px}.bpx-tab,.bpx-btn{min-width:44px;min-height:44px}}
  .bpx-body{padding:12px 16px 20px;overflow:auto;flex:1}
  .bpx-card{border:1px solid var(--border);border-radius:12px;padding:11px 12px;margin-bottom:9px;background:var(--bg)}
  .bpx-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.bpx-grow{flex:1;min-width:0}
  .bpx-name{font-weight:700;font-size:14px}.bpx-sub{font-size:12px;color:var(--muted)}
  .bpx-price{font:700 15px var(--font,system-ui);white-space:nowrap}
  .bpx-chip{font:700 11px var(--font,system-ui);padding:3px 8px;border-radius:999px;border:1px solid var(--border);white-space:nowrap;display:inline-block}
  .bpx-chip.g{color:#047857;background:#ecfdf5;border-color:#a7f3d0}.bpx-chip.b{color:#9a3412;background:#fff7ed;border-color:#fed7aa}.bpx-chip.w{color:#92400e;background:#fffbeb;border-color:#fde68a}.bpx-chip.n{color:var(--muted)}
  html[data-theme=dark] .bpx-chip.g,.dark .bpx-chip.g{background:#052015;color:#6ee7b7;border-color:#065f46}
  html[data-theme=dark] .bpx-chip.b,.dark .bpx-chip.b{background:#2a1208;color:#fdba74;border-color:#7c2d12}
  html[data-theme=dark] .bpx-chip.w,.dark .bpx-chip.w{background:#2a1c05;color:#fcd34d;border-color:#78350f}
  .bpx-btn{background:var(--input-bg);border:1px solid var(--border);color:var(--text);font:600 13px var(--font,system-ui);padding:8px 12px;border-radius:10px;cursor:pointer}
  .bpx-btn.p{background:#2f7fd0;border-color:#2f7fd0;color:#fff}.bpx-btn.d{color:var(--danger)}.bpx-btn:disabled{opacity:.5;cursor:not-allowed}.bpx-btn.s{padding:5px 10px;font-size:12px}
  .bpx-in{background:var(--input-bg);border:1.5px solid var(--border);color:var(--text);border-radius:9px;padding:8px 10px;font:14px var(--font,system-ui);min-width:0;width:100%}
  .bpx-lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:8px 0 3px;display:block}
  .bpx-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.bpx-note{font-size:12px;color:var(--muted);margin:6px 0}
  .bpx-bar{display:none;gap:8px;flex-wrap:wrap;padding:8px 12px}.bpx-bar.on{display:flex}
  .bpx-chart{width:100%;height:auto;background:var(--input-bg);border-radius:10px}
  .bpx-empty{text-align:center;color:var(--muted);padding:26px 8px;font-size:14px}
  .bpx-code{font:700 20px ui-monospace,monospace;letter-spacing:2px;user-select:all}
  .bpx-csv-example{margin:6px 0;padding:9px;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font:11px/1.5 ui-monospace,monospace;white-space:pre;overflow-x:auto}
  /* ---- deal cards (hub + inline under shopping-list items) ---- */
  .bpx-dealslot:empty{display:none}.bpx-dealslot{margin:-2px 0 10px 36px}
  .grocery-item.done + .bpx-dealslot{display:none}
  @media (max-width:520px){.bpx-dealslot{margin-left:10px}}
  .bpx-dc{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;border:1px solid var(--border);border-left:3px solid var(--border);border-radius:10px;padding:9px 11px;margin-bottom:6px;background:var(--white,#fff);color:var(--text)}
  .bpx-sheet .bpx-dc{background:var(--bg)}
  .bpx-dc.good{border-left-color:#10b981}.bpx-dc.needclip{border-left-color:#f59e0b;border-style:dashed;border-left-style:solid}
  .bpx-dc-l{min-width:0}.bpx-dc-r{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
  .bpx-dc-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted)}
  .bpx-tag{font:800 10px var(--font,system-ui);letter-spacing:.4px;text-transform:uppercase;padding:2px 6px;border-radius:5px;background:var(--input-bg);color:var(--muted)}
  .bpx-tag.c{background:#fffbeb;color:#92400e}html[data-theme=dark] .bpx-tag.c,.dark .bpx-tag.c{background:#2a1c05;color:#fcd34d}
  .bpx-urgent{color:#b45309;font-weight:700}.dark .bpx-urgent{color:#fcd34d}
  .bpx-dc-name{font-weight:700;font-size:13.5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bpx-dc-how{font-size:12px;color:var(--muted)}.bpx-dc-how s{opacity:.8}
  .bpx-dc-up{font:800 17px var(--font,system-ui);white-space:nowrap;line-height:1.1}.bpx-dc-up small{font:600 11px var(--font,system-ui);color:var(--muted)}
  .bpx-dc.needclip .bpx-dc-up{opacity:.75}
  .bpx-dc-act{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
  .bpx-more{margin:0 0 6px}.bpx-more>summary{cursor:pointer;font:600 12px var(--font,system-ui);color:var(--muted);padding:2px 0 6px;list-style:revert}
  /* ---- share-list flow + tabs ---- */
  .bpx-tabs .bpx-tab{padding:9px 4px;line-height:1.2}
  .bpx-step{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}.bpx-step:last-of-type{border-bottom:none}
  .bpx-stepn{flex:none;width:24px;height:24px;border-radius:50%;background:var(--input-bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font:700 12px var(--font,system-ui)}
  .bpx-step.done .bpx-stepn{background:#10b981;border-color:#10b981;color:#fff}
  .bpx-step .bpx-sub,.bpx-step .bpx-note{margin:3px 0}
  .bpx-people .bpx-row{padding:2px 0}
  `;

  /* ------------------------------ mount ------------------------------ */
  let mounted = false, pill, pillText$, srEl, hubBtn, bar, alertCount = 0;
  ui.mount = function () {
    if (mounted) return; mounted = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const right = $('.hdr-right');
    pill = document.createElement('button'); pill.className = 'bpx-pill'; pill.type = 'button';
    pill.innerHTML = '<svg class="bpx-ic" viewBox="0 0 14 14" aria-hidden="true">'
      + '<path class="s-synced" d="M3 7.5l2.6 2.6L11 4.5" fill="none" stroke="#34d399" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle class="s-saved" cx="7" cy="7" r="3.2" fill="#fbbf24"/>'
      + '<path class="s-syncing" d="M7 2a5 5 0 1 1-4.6 3" fill="none" stroke="#60a5fa" stroke-width="1.8" stroke-linecap="round"/>'
      + '<circle class="s-offline" cx="7" cy="7" r="3.4" fill="none" stroke="#cbd5e1" stroke-width="1.6"/>'
      + '<path class="s-error" d="M7 3v5M7 10.6v.4" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round"/></svg>'
      + '<span class="bpx-t"></span><span class="bpx-sr" role="status" aria-live="polite"></span>';
    pillText$ = $('.bpx-t', pill); srEl = $('.bpx-sr', pill);
    pill.onclick = onPillClick;
    hubBtn = document.createElement('button'); hubBtn.className = 'bpx-hubbtn'; hubBtn.type = 'button';
    hubBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg><span class="bpx-badge" id="bpxBadge"></span>';
    hubBtn.onclick = () => openHub('book');
    if (right) { right.insertBefore(hubBtn, right.firstChild); right.insertBefore(pill, right.firstChild); }
    const gl = $('#tab-grocery .grocery-layout');
    if (gl) {
      bar = document.createElement('div'); bar.className = 'bpx-bar';
      bar.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'replenish') openReplenish(); else if (a === 'sharelist') openShareList(); else if (a === 'listdeals') openHub('deals'); };
      gl.parentNode.insertBefore(bar, gl);
    }
    const aw = $('.analysis-wrap');
    if (aw) { const b = document.createElement('button'); b.id = 'bpxSavePrices'; b.className = 'bpx-btn'; b.style.cssText = 'display:none;margin:8px 0'; b.onclick = openSavePrices; aw.appendChild(b); }
    labelStatics();
    bp.on('status', s => { renderStatus(s); if (s.state === 'synced') { mcache.forEach(c => { c.at = 0; }); ui.decorateList(); } });
    bp.on('alert', a => {
      alertCount++; setBadge();
      if (a) toast(tr(a.store ? 'toast_alert_at' : 'toast_alert', { name: a.product_name, store: a.store, price: money(a.unit_price), unit: a.base_unit }), 'ok');
    });
    bp.on('conflicts', () => {});
    global.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    document.addEventListener('click', inlineDealClick);
  };
  function labelStatics() {                                     // everything that is set once but must follow the language
    if (hubBtn) { hubBtn.title = tr('hub_tip'); hubBtn.setAttribute('aria-label', tr('hub_aria')); }
    if (bar) bar.innerHTML = `<button class="bpx-btn" data-a="replenish">${h(tr('bar_replenish'))}</button><button class="bpx-btn" data-a="sharelist">${h(tr('bar_share'))}</button><button class="bpx-btn" data-a="listdeals">${h(tr('bar_deals'))}</button>`;
    const sb = $('#bpxSavePrices'); if (sb) sb.textContent = tr('save_prices_btn');
  }
  ui.relang = function () {                                     // call from applyLang()
    if (!mounted) return;
    labelStatics(); if (lastS) paint(lastS);
    closeSheet(); $$('.bpx-dealslot').forEach(s => { s._h = null; }); ui.decorateList();
  };
  ui.refresh = function () {                                    // call after bp.start() resolves / on sign-out
    if (!mounted) return;
    const on = !!bp.enabled; pill.classList.toggle('on', on); hubBtn.classList.toggle('on', on); bar && bar.classList.toggle('on', on);
    if (on) { shownState = null; renderStatus(bp.status()); loadAlertCount(); ui.decorateList(); } else mcache.clear();
  };
  ui.showSaveButton = show => { const b = $('#bpxSavePrices'); if (b) b.style.display = show && bp.enabled ? 'inline-block' : 'none'; };

  /* ------------------------------ sync status pill ------------------------------
   * Goals: never flash, never nag. A sync that finishes in <350 ms is not shown at all; one that did start stays visible for
   * at least 700 ms so it reads as a deliberate state. "Synced" confirms for 2.5 s, then collapses to a quiet check mark
   * (text returns on hover / focus / tap). Amber/red/offline states keep their text because they need attention.
   * Each state also has its own icon shape, so meaning never depends on colour alone. */
  const SYNC_DELAY = 350, MIN_SYNC_MS = 700, QUIET_MS = 2500;
  let shownState = null, shownAt = 0, lastS = null, wantS = null, timer = null, quietT = null, peekT = null;
  function pillCopy(s) {
    switch (s.state) {
      case 'synced': return [tr('pill_synced'), tr('pill_synced_tip')];
      case 'syncing': return [tr('pill_syncing'), tr('pill_syncing_tip')];
      case 'saved': return online() ? [tr('pill_saved'), tr('pill_saved_tip')] : [tr('pill_saved_off'), trn('pill_saved_off_tip', s.pending || 0)];
      case 'offline': return [tr('pill_offline'), tr('pill_offline_tip')];
      case 'error': return [tr('pill_error'), trn('pill_error_tip', s.pending || 0)];
      default: return ['', ''];
    }
  }
  function renderStatus(s) {
    lastS = wantS = s; if (!pill) return;
    if (s.state === 'syncing' && shownState !== 'syncing') {   // fast syncs never show; don't restart the timer on repeat events
      if (!timer) timer = setTimeout(() => { timer = null; paint(wantS); }, SYNC_DELAY);
      return;
    }
    clearTimeout(timer); timer = null;
    if (shownState === 'syncing' && s.state !== 'syncing') {   // leaving "syncing": hold it long enough to be readable
      const wait = MIN_SYNC_MS - (Date.now() - shownAt);
      if (wait > 0) { timer = setTimeout(() => { timer = null; paint(wantS); }, wait); return; }
    }
    paint(s);
  }
  function paint(s) {
    const [text, tip] = pillCopy(s), was = shownState;
    shownState = s.state; shownAt = Date.now();
    pill.dataset.s = s.state; pillText$.textContent = text; pill.title = tip; pill.setAttribute('aria-label', tip || text);
    clearTimeout(quietT); clearTimeout(peekT); pill.classList.remove('peek');
    if (s.state === 'synced') {
      if (was === null || was === 'synced') pill.classList.add('quiet');       // first paint / repeat: stay calm
      else { pill.classList.remove('quiet'); quietT = setTimeout(() => pill.classList.add('quiet'), QUIET_MS); }
    } else pill.classList.remove('quiet');
    if (was !== null && was !== s.state && srEl) srEl.textContent = tip;        // screen readers hear real transitions only
  }
  function onPillClick() {
    const s = bp.status();
    pill.classList.add('peek'); clearTimeout(peekT); peekT = setTimeout(() => pill.classList.remove('peek'), 3000);
    if (s.state === 'synced') toast(tr('toast_synced'), 'ok');
    else if (!online()) toast(tr('toast_offline'), 'ok');
    else if (s.state === 'error' || s.state === 'saved') { toast(tr('toast_retrying'), 'ok'); Promise.resolve(bp.retryNow()).catch(() => {}); }
    else toast(pillCopy(s)[1], 'ok');
  }
  async function loadAlertCount() { try { alertCount = (await bp.price.alerts()).length; setBadge(); } catch (e) { /* offline */ } }
  function setBadge() { const b = $('#bpxBadge'); if (!b) return; b.textContent = alertCount > 9 ? '9+' : alertCount; b.style.display = alertCount ? 'flex' : 'none'; }

  /* ------------------------------ sheet plumbing ------------------------------ */
  let sheetEl = null, lastFocus = null;
  function openSheet(title, bodyHtml, tabs, active) {
    closeSheet(); lastFocus = document.activeElement;
    sheetEl = document.createElement('div'); sheetEl.className = 'bpx-ov';
    sheetEl.innerHTML = `<div class="bpx-sheet" role="dialog" aria-modal="true" aria-label="${h(title)}">
      <div class="bpx-hd"><h2>${h(title)}</h2><button class="bpx-x" data-a="close" aria-label="${h(tr('close'))}">&#10005;</button></div>
      ${tabs ? `<div class="bpx-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="bpx-tab" role="tab" data-a="tab" data-k="${k}" aria-selected="${k === active}">${h(l)}</button>`).join('')}</div>` : ''}
      <div class="bpx-body" id="bpxBody">${bodyHtml || ''}</div></div>`;
    sheetEl.addEventListener('mousedown', e => { if (e.target === sheetEl) closeSheet(); });
    document.body.appendChild(sheetEl); $('.bpx-x', sheetEl).focus();
    return $('#bpxBody', sheetEl);
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; try { lastFocus && lastFocus.focus(); } catch (e) { /* gone */ } } }
  const body = () => $('#bpxBody');
  const busy = () => { body().innerHTML = `<div class="bpx-empty">${h(tr('loading'))}</div>`; };
  const fail = e => { console.error(e); body().innerHTML = `<div class="bpx-empty">${h(online() ? tr('err_generic') : tr('err_offline'))}</div>`; };

  /* ------------------------------ hub ------------------------------ */
  const tabsList = () => [['book', tr('tab_book')], ['deals', tr('tab_deals')], ['house', tr('tab_house')]];
  async function openHub(tab) {
    openSheet(tr('sheet_title'), '', tabsList(), tab);
    sheetEl.addEventListener('click', hubClick);
    sheetEl.addEventListener('submit', e => e.preventDefault());
    sheetEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-a="product"]')) hubClick(e); });
    if (ui._install) {
      const ib = document.createElement('button'); ib.className = 'bpx-btn'; ib.textContent = tr('install_app');
      ib.onclick = async () => { try { ui._install.prompt(); await ui._install.userChoice; } catch (e) { /* dismissed */ } ui._install = null; ib.remove(); };
      $('.bpx-hd', sheetEl).insertBefore(ib, $('.bpx-x', sheetEl));
    } else if (/iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone) {
      $('.bpx-tabs', sheetEl).insertAdjacentHTML('afterend', `<div class="bpx-note" style="padding:6px 16px 0">${h(tr('ios_install'))}</div>`);
    }
    await showTab(tab);
  }
  async function showTab(tab) {
    $$('.bpx-tab').forEach(t => t.setAttribute('aria-selected', t.dataset.k === tab));
    busy();
    try { await ({ book: renderBook, deals: renderDeals, house: renderHouse })[tab](); } catch (e) { fail(e); }
  }

  async function hubClick(e) {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    try {
      if (a === 'close') return closeSheet();
      if (a === 'tab') return showTab(el.dataset.k);
      if (a === 'product') return renderProduct(el.dataset.k);
      if (a === 'back') return showTab('book');
      if (a === 'readalerts') { await bp.price.markAlertsRead(); alertCount = 0; setBadge(); return showTab('book'); }
      if (a === 'settarget') return saveTarget(el.dataset.k);
      if (a === 'deltarget') { await bp.price.deleteTarget(el.dataset.id); toast(tr('t_removed'), 'ok'); return renderProduct(el.dataset.k); }
      if (a === 'delentry') { await bp.price.remove(el.dataset.id); toast(tr('p_removed'), 'ok'); return renderProduct(el.dataset.k); }
      if (a === 'toggle') {                                   // Offers tab: reveal one secondary panel at a time
        const open = document.getElementById(el.dataset.t).hidden;
        ['dlAddPanel', 'dlImpPanel'].forEach(id => {
          const p = document.getElementById(id), b = sheetEl.querySelector('[data-t="' + id + '"]'), on = open && id === el.dataset.t;
          if (p) p.hidden = !on; if (b) b.setAttribute('aria-expanded', String(on));
        });
        if (open) { const f = document.getElementById(el.dataset.t).querySelector('input,textarea'); if (f) f.focus(); }
        return;
      }
      if (a === 'savefromcmp') {                              // Price history empty state: the one primary action
        const res = (ui.host.getCompare && ui.host.getCompare()) || [];
        if (res.some(r => r.n && !/^Item \d+$/.test(r.n))) return openSavePrices();
        closeSheet(); if (ui.host.goCompare) ui.host.goCompare(); toast(tr('pb_go_compare')); return;
      }
      if (a === 'shmk') return shMake();
      if (a === 'shjoin') return shJoin();
      if (a === 'shshare') return shShare(el);
      if (a === 'shinvite') { shInvite = { hid: el.dataset.id, code: await bp.households.invite(el.dataset.id) }; const box = $('#shInv'); if (box) box.innerHTML = inviteHtml(shInvite.code); el.textContent = tr('sh_new_invite_btn'); return; }
      if (a === 'shcopy') return shCopy();
      if (a === 'shsend') return shSend();
      if (a === 'shstop') return shStop();
      if (a === 'shmanage') return openHub('house');
      if (a === 'adddeal') return submitDeal();
      if (a === 'clip') { await bp.deals.clip(el.dataset.id, el.dataset.v === '1'); patchCachedDeal(el.dataset.id, { clipped: el.dataset.v === '1' }); return showTab('deals'); }
      if (a === 'deldeal') { await bp.deals.remove(el.dataset.id); mcache.forEach(c => { c.at = 0; }); return showTab('deals'); }
      if (a === 'dealtocompare') return dealToCompare(el.dataset.id);
      if (a === 'importdeals') return importDeals();
      if (a === 'mkhouse') return mkHouse();
      if (a === 'joinhouse') return joinHouse();
      if (a === 'invite') { const c = await bp.households.invite(el.dataset.id); $('#bpxInv' + el.dataset.id).innerHTML = `<div class="bpx-note">${h(tr('invite_note'))}</div><div class="bpx-code">${h(c)}</div>`; el.textContent = tr('invite_again'); return; }
      if (a === 'leave') { if (confirm(tr('confirm_leave'))) { await bp.households.leave(el.dataset.id); return showTab('house'); } }
      if (a === 'kick') { if (confirm(tr('confirm_kick'))) { await bp.households.removeMember(el.dataset.hid, el.dataset.uid); return showTab('house'); } }
    } catch (err) { console.error(err); toast(errMsg(err), ''); }
  }
  function errMsg(e) {
    const m = (e && e.message) || '';
    if (/invalid_or_expired_invite|invite.*(?:invalid|expired|used|limit)/i.test(m)) return tr('e_invite');
    if (/household is full/.test(m)) return tr('e_full');
    if (/limit reached/.test(m)) return tr('e_limit');
    if (!online()) return tr('e_offline');
    return tr('e_generic');
  }

  /* ------------------------------ price book ------------------------------ */
  let pbRows = [], pbTargets = [];
  const groupKey = r => r.product_key + '|' + r.base_unit;
  // Verdict wording is owned by the UI (translated); bp.price.verdict supplies the code. n / last are recomputed here from
  // the rows so an older bp-store.js (cached by the service worker) still renders correctly.
  function vInfo(list, target) {
    const v = bp.price.verdict(list, target) || { code: 'none' };
    const known = STR.en['v_' + v.code] != null;
    return { code: v.code, n: list.length, last: list.length ? list[0].observed_at : null, label: known ? tr('v_' + v.code) : (v.label || '') };
  }
  const vClass = c => (['target', 'lowest', 'near', 'good'].includes(c) ? 'g' : c === 'high' ? 'b' : 'n');
  const metaLine = v => (v.n && v.last ? trn('meta', v.n, { date: fmtDate(v.last) }) : '');

  async function renderBook() {
    const [{ rows, cached }, targets, alerts] = await Promise.all([bp.price.history(), bp.price.targets().catch(() => []), bp.price.alerts().catch(() => [])]);
    pbRows = rows; pbTargets = targets;
    const groups = new Map();
    rows.forEach(r => { const k = groupKey(r); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
    let html = cached ? `<div class="bpx-note">${h(tr('pb_cached'))}</div>` : '';
    if (groups.size) html += `<div class="bpx-note">${h(tr('pb_scope_note'))}</div>`;   // always visible: this is YOUR record, not market data
    if (alerts.length) html += `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow bpx-name">${h(trn('alerts', alerts.length))}</div><button class="bpx-btn" data-a="readalerts">${h(tr('mark_read'))}</button></div>${alerts.slice(0, 6).map(a => `<div class="bpx-sub">${h(tr(a.store ? 'alert_row_at' : 'alert_row', { name: a.product_name, store: a.store, price: money(a.unit_price), unit: a.base_unit, target: money(a.target_unit_price) }))}</div>`).join('')}</div>`;
    if (!groups.size) html += `<div class="bpx-empty"><b>${h(tr('pb_empty_1'))}</b><br>${h(tr('pb_empty_2'))}<div style="margin-top:14px"><button class="bpx-btn p" data-a="savefromcmp">${h(tr('pb_empty_cta'))}</button></div></div><div class="bpx-note" style="text-align:center">${h(tr('pb_scope_note'))}</div>`;
    for (const [k, list] of [...groups].sort((a, b) => b[1][0].observed_at.localeCompare(a[1][0].observed_at))) {
      const t = pbTargets.find(x => x.product_key === list[0].product_key && x.base_unit === list[0].base_unit && x.active);
      const v = vInfo(list, t), best = list.reduce((m, r) => (+r.unit_price < +m.unit_price ? r : m), list[0]);
      const bestTxt = tr(best.store ? 'pb_best_at' : 'pb_best', { price: money(best.unit_price, best.currency), unit: best.base_unit, store: best.store });
      html += `<div class="bpx-card" data-a="product" data-k="${h(k)}" style="cursor:pointer" tabindex="0"><div class="bpx-row"><div class="bpx-grow"><div class="bpx-name">${h(list[0].product_name)}</div>
        <div class="bpx-sub">${h(bestTxt)}</div><div class="bpx-sub">${h(metaLine(v))}</div></div>
        <div style="text-align:right"><div class="bpx-price">${money(list[0].unit_price, list[0].currency)}<span class="bpx-sub">/${h(list[0].base_unit)}</span></div>
        <span class="bpx-chip ${vClass(v.code)}">${h(v.label)}</span></div></div></div>`;
    }
    body().innerHTML = html;
  }
  function chart(rows, target) {
    const pts = rows.slice().reverse(); if (pts.length < 2) return `<div class="bpx-note">${h(tr('chart_need_two'))}</div>`;
    const W = 320, H = 120, P = 12, ys = pts.map(r => +r.unit_price).concat(target ? [+target.target_unit_price] : []);
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || hi || 1;
    const X = i => P + (i * (W - 2 * P)) / (pts.length - 1), Y = v => H - P - ((v - lo) / span) * (H - 2 * P);
    return `<svg class="bpx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(tr('chart_aria', { n: pts.length, from: money(pts[0].unit_price), to: money(pts[pts.length - 1].unit_price) }))}">
      ${target ? `<line x1="${P}" x2="${W - P}" y1="${Y(+target.target_unit_price)}" y2="${Y(+target.target_unit_price)}" stroke="#10b981" stroke-dasharray="4 3"/>` : ''}
      <polyline fill="none" stroke="#2f7fd0" stroke-width="2" points="${pts.map((r, i) => `${X(i)},${Y(+r.unit_price)}`).join(' ')}"/>
      ${pts.map((r, i) => `<circle cx="${X(i)}" cy="${Y(+r.unit_price)}" r="3" fill="#2f7fd0"/>`).join('')}</svg>
      <div class="bpx-sub" style="display:flex;justify-content:space-between"><span>${fmtDate(pts[0].observed_at)}</span>${target ? `<span style="color:#10b981">${h(tr('chart_target'))}</span>` : ''}<span>${fmtDate(pts[pts.length - 1].observed_at)}</span></div>`;
  }
  function renderProduct(k) {
    const list = pbRows.filter(r => groupKey(r) === k); if (!list.length) return showTab('book');
    const f = list[0], t = pbTargets.find(x => x.product_key === f.product_key && x.base_unit === f.base_unit && x.active), v = vInfo(list, t);
    const byStore = new Map(); list.forEach(r => { const s = r.store || tr('unknown_store'); if (!byStore.has(s) || +r.unit_price < +byStore.get(s).unit_price) byStore.set(s, r); });
    const me = bp.me();
    body().innerHTML = `<button class="bpx-btn" data-a="back">&larr; ${h(tr('tab_book'))}</button>
      <h3 style="margin:10px 0 4px">${h(f.product_name)}</h3>
      <div class="bpx-row" style="margin-bottom:2px"><span class="bpx-chip ${vClass(v.code)}">${h(v.label)}</span><span class="bpx-sub">${h(tr('latest', { price: money(f.unit_price, f.currency), unit: f.base_unit }))}</span></div>
      ${v.n ? `<div class="bpx-sub">${h(trn('basis', v.n, { date: fmtDate(v.last) }))}</div><div class="bpx-note" style="margin-top:2px">${h(tr('basis_note'))}</div>` : ''}
      <div style="margin:10px 0">${chart(list, t)}</div>
      <span class="bpx-lbl">${h(tr('best_by_store'))}</span>${[...byStore].sort((a, b) => a[1].unit_price - b[1].unit_price).map(([s, r]) => `<div class="bpx-row bpx-sub" style="justify-content:space-between"><span>${h(s)}</span><b>${money(r.unit_price, r.currency)}/${h(r.base_unit)}</b></div>`).join('')}
      <span class="bpx-lbl">${h(tr('target_lbl', { unit: f.base_unit }))}</span>
      <div class="bpx-row"><input class="bpx-in bpx-grow" id="bpxTarget" inputmode="decimal" placeholder="${h(tr('target_ph', { v: (+f.unit_price * 0.9).toFixed(4) }))}" value="${t ? h(t.target_unit_price) : ''}" aria-label="${h(tr('target_aria'))}">
        <button class="bpx-btn p" data-a="settarget" data-k="${h(k)}">${h(t ? tr('update') : tr('set_alert'))}</button>${t ? `<button class="bpx-btn d" data-a="deltarget" data-id="${h(t.id)}" data-k="${h(k)}">${h(tr('remove'))}</button>` : ''}</div>
      <div class="bpx-note">${h(tr('target_note'))}</div>
      <span class="bpx-lbl">${h(tr('history'))}</span>${list.slice(0, 40).map(r => `<div class="bpx-row bpx-sub" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0"><span>${fmtDate(r.observed_at)} · ${h(r.store || '—')}</span><span><b>${money(r.unit_price, r.currency)}</b>${r.user_id === me ? ` <button class="bpx-btn d" style="padding:2px 8px" data-a="delentry" data-id="${h(r.id)}" data-k="${h(k)}" aria-label="${h(tr('del_price_aria'))}">&#10005;</button>` : ''}</span></div>`).join('')}`;
  }
  async function saveTarget(k) {
    const f = pbRows.find(r => groupKey(r) === k), v = parseFloat($('#bpxTarget').value);
    if (!(v > 0)) return toast(tr('t_invalid'));
    await bp.price.setTarget({ product_name: f.product_name, base_unit: f.base_unit, target_unit_price: v });
    pbTargets = await bp.price.targets(); toast(tr('t_set'), 'ok'); renderProduct(k);
  }

  /* save-from-comparison sheet */
  async function openSavePrices() {
    const res = (ui.host.getCompare && ui.host.getCompare()) || [];
    const rows = res.filter(r => r.n && !/^Item \d+$/.test(r.n));
    if (!rows.length) return toast(tr('sp_name_first'));
    let hs = []; try { hs = await bp.households.list(); } catch (e) { /* offline: personal only */ }
    const stores = ui.host.preferredStores();
    const b = openSheet(tr('sp_title'), `<datalist id="bpxStores">${stores.map(s => `<option value="${h(s)}">`).join('')}</datalist>
      <div class="bpx-note">${h(tr('sp_note'))}</div>
      ${rows.map((r, i) => `<div class="bpx-card"><label class="bpx-row"><input type="checkbox" data-i="${i}" checked><span class="bpx-grow"><span class="bpx-name">${h(r.n)}</span><br><span class="bpx-sub">${money(r.up, ui.host.currency())} / ${h(r.baseUnit)}</span></span></label>
        <input class="bpx-in" data-s="${i}" list="bpxStores" placeholder="${h(tr('store_ph'))}" aria-label="${h(tr('store_aria', { name: r.n }))}"></div>`).join('')}
      ${hs.length ? `<span class="bpx-lbl">${h(tr('share_with'))}</span><select class="bpx-in" id="bpxScope"><option value="">${h(tr('just_me'))}</option>${hs.map(x => `<option value="${h(x.id)}">${h(tr('hh_suffix', { name: x.name }))}</option>`).join('')}</select>` : ''}
      <div class="bpx-row" style="margin-top:12px"><button class="bpx-btn p bpx-grow" id="bpxDoSave">${h(tr('save_btn'))}</button></div>`);
    $('#bpxDoSave', b).onclick = () => {
      const entries = rows.map((r, i) => (b.querySelector(`[data-i="${i}"]`).checked ? {
        product_name: r.n, store: b.querySelector(`[data-s="${i}"]`).value.trim(), unit_price: r.up, base_unit: r.baseUnit, unit_family: r.fam,
        currency: ui.host.currency(), pkg_price: r.price, pkg_size: r.size, pkg_qty: r.qty, pkg_unit: r.unit,
        discount_value: r.dv || null, discount_type: r.dv ? (r.dt === 'p' ? 'p' : 'd') : null,
      } : null)).filter(Boolean);
      const n = bp.price.add(entries, $('#bpxScope', b)?.value || null);
      closeSheet(); toast(n ? trn('saved', n) : tr('nothing_sel'), n ? 'ok' : '');
    };
  }
  ui.openSavePrices = openSavePrices;

  /* ------------------------------ deals ------------------------------ */
  const UNITS = ['oz', 'lb', 'g', 'kg', 'ml', 'l', 'gal', 'count', 'sheets', 'ft', 'in', 'yd', 'm'];
  async function bestPrices() {                         // product_key|baseUnit -> best unit price in the price book
    const map = new Map(); try { (await bp.price.history()).rows.forEach(r => { const k = r.product_key + '|' + r.base_unit; if (!map.has(k) || +r.unit_price < map.get(k)) map.set(k, +r.unit_price); }); } catch (e) { /* no history */ }
    return map;
  }
  function howText(d) {
    const cur = ui.host.currency();
    if (d.discount_type === 'p') return tr('how_p', { v: +d.discount_value });
    if (d.discount_type === 'd') return tr('how_d', { v: money2(d.discount_value, cur) });
    if (d.discount_type === 'bogo') return tr('how_bogo', { buy: d.buy_qty, get: d.get_qty });
    return tr('how_sale');
  }
  function endsText(d) {
    if (!d.valid_to) return null;
    const days = Math.round((new Date(d.valid_to + 'T00:00:00') - new Date(localISO() + 'T00:00:00')) / 864e5);
    return { text: days <= 0 ? tr('dc_ends_today') : days === 1 ? tr('dc_ends_tomorrow') : tr('dc_ends', { date: fmtDate(d.valid_to) }), urgent: days <= 1 };
  }
  // One evaluated deal: effective unit price (via bp.deals.effective) + comparison against the price-book best.
  function evalDeal(d, best) {
    const e = bp.deals.effective(d, ui.host.unitRates());
    const b = e && best ? best.get(d.name_key + '|' + e.baseUnit) : undefined;
    const diff = e && b ? (e.unitPrice - b) / b * 100 : null;
    return { d, e, b, diff };
  }
  const cmpText = diff => (Math.abs(diff) < 1 ? tr('cmp_same') : diff < 0 ? tr('cmp_below', { n: Math.abs(diff).toFixed(0) }) : tr('cmp_above', { n: diff.toFixed(0) }));

  // Compact two-column card: left = what/where/when/how, right = effective unit price + comparison. Used in the hub and inline in the list.
  function dealCard(ev, o) {
    o = o || {}; const { d, e, b, diff } = ev, cur = ui.host.currency();
    const coupon = d.kind === 'coupon', needClip = coupon && !d.clipped, ends = endsText(d), good = diff != null && diff < -1;
    const cls = ['bpx-dc', good ? 'good' : '', needClip ? 'needclip' : ''].filter(Boolean).join(' ');
    const how = [howText(d)];
    if (e) how.push(`${h(tr('dc_regular'))} <s>${money2(d.pkg_price, cur)}</s> → <b>${money2(e.net, cur)}</b> ${h(tr('dc_per_pack'))}`); else how.push('');
    const howHtml = h(how[0]) + (e ? ' · ' + how[1] : '') + (d.discount_type === 'bogo' ? ` <span title="${h(tr('bogo_note'))}">*</span>` : '');
    return `<div class="${cls}" role="group" aria-label="${h(d.product_name)}">
      <div class="bpx-dc-l">
        <div class="bpx-dc-top"><span class="bpx-tag${coupon ? ' c' : ''}">${h(tr(coupon ? 'dc_coupon' : 'dc_ad'))}</span>${d.store ? `<span>${h(d.store)}</span>` : ''}${ends ? `<span class="${ends.urgent ? 'bpx-urgent' : ''}">· ${h(ends.text)}</span>` : ''}</div>
        <div class="bpx-dc-name">${o.item ? `${h(o.item)} <span class="bpx-sub">→</span> ` : ''}${h(d.product_name)}</div>
        <div class="bpx-dc-how">${howHtml}</div>
      </div>
      <div class="bpx-dc-r">
        ${e ? `<div class="bpx-dc-up">${money(e.unitPrice, cur)}<small>/${h(e.baseUnit)} ${h(tr('dc_effective'))}</small></div>` : `<div class="bpx-sub">${h(tr('dc_unsupported'))}</div>`}
        ${o.best ? `<span class="bpx-chip g">${h(tr('dc_best'))}</span>` : ''}
        ${needClip ? `<span class="bpx-chip w">${h(tr('dc_clip_needed'))}</span>` : ''}
        ${diff != null ? `<span class="bpx-chip ${good ? 'g' : 'n'}">${h(cmpText(diff))}</span><span class="bpx-sub">${h(tr('dc_vs_best', { price: money(b, cur), unit: e.baseUnit }))}</span>` : ''}
      </div>
      <div class="bpx-dc-act"><button class="bpx-btn s" data-a="dealtocompare" data-id="${h(d.id)}">${h(tr('compare'))}</button>
        ${coupon ? `<button class="bpx-btn s${needClip ? ' p' : ''}" data-a="clip" data-id="${h(d.id)}" data-v="${d.clipped ? 0 : 1}">${h(tr(d.clipped ? 'unclip' : 'clip'))}</button>` : ''}
        ${o.del ? `<button class="bpx-btn s d" data-a="deldeal" data-id="${h(d.id)}">${h(tr('delete'))}</button>` : ''}</div>
    </div>`;
  }
  // Order matches for one item: cheapest effective unit price first (only comparable within the same base unit); unsupported units last.
  function rankDeals(evs) {
    const sorted = evs.slice().sort((a, b) => (a.e ? 0 : 1) - (b.e ? 0 : 1) || (a.e && b.e && a.e.baseUnit === b.e.baseUnit ? a.e.unitPrice - b.e.unitPrice : 0));
    const comparable = sorted.filter(x => x.e && sorted[0].e && x.e.baseUnit === sorted[0].e.baseUnit).length;
    return { sorted, topIsBest: comparable > 1 };
  }

  /* inline: matched offers under each shopping-list item */
  const MATCH_TTL = 60000;
  const mcache = new Map(), inflight = new Set();               // listId -> { at, sig, matches, best }
  const listSig = lid => (ui.host.listItems ? ui.host.listItems(lid) : []).map(i => i.id + ':' + bp.normKey(i.name)).join('|');
  ui.decorateList = function () {
    if (!mounted || !bp.enabled) return;
    const lid = ui.host.activeListId(); if (!lid || !$$('.bpx-dealslot').length) return;
    const key = String(lid), c = mcache.get(key), sig = listSig(lid);
    if (c) paintSlots(c);                                       // paint from cache first: no flicker on re-render
    if (!c || c.sig !== sig || Date.now() - c.at > MATCH_TTL) refreshMatches(key, sig);
  };
  async function refreshMatches(key, sig) {
    if (inflight.has(key)) return; inflight.add(key);
    try {
      const [matches, best] = await Promise.all([bp.deals.matchesForList(key), bestPrices()]);
      const next = { at: Date.now(), sig, matches: matches || [], best }; mcache.set(key, next);
      if (String(ui.host.activeListId()) === key) paintSlots(next);
    } catch (e) {                                               // offline / RPC missing: keep whatever we have, retry in ~10 s
      const prev = mcache.get(key) || { sig, matches: [], best: new Map() }; prev.at = Date.now() - MATCH_TTL + 10000; mcache.set(key, prev);
    } finally { inflight.delete(key); }
  }
  function paintSlots(c) {
    const today = localISO(), byItem = new Map(), seen = new Set();
    (c.matches || []).forEach(m => {
      if (!m.deal || (m.deal.valid_to && m.deal.valid_to < today)) return;
      const k = m.item_id + '|' + m.deal.id; if (seen.has(k)) return; seen.add(k);
      const id = String(m.item_id); (byItem.get(id) || byItem.set(id, []).get(id)).push(m.deal);
    });
    $$('.bpx-dealslot').forEach(slot => {
      const deals = byItem.get(String(slot.dataset.item)); let html = '';
      if (deals) {
        const { sorted, topIsBest } = rankDeals(deals.map(d => evalDeal(d, c.best)));
        html = dealCard(sorted[0], { best: topIsBest });
        if (sorted.length > 1) html += `<details class="bpx-more"><summary>${h(trn('dc_more', sorted.length - 1))}</summary>${sorted.slice(1).map(x => dealCard(x)).join('')}</details>`;
      }
      if (slot._h !== html) { slot.innerHTML = html; slot._h = html; }   // skip identical repaints so open <details> survive
    });
  }
  const findDeal = id => { for (const c of mcache.values()) { const m = (c.matches || []).find(x => x.deal && x.deal.id === id); if (m) return m.deal; } return (ui._deals || []).find(x => x.id === id) || null; };
  function patchCachedDeal(id, patch) { mcache.forEach(c => (c.matches || []).forEach(m => { if (m.deal && m.deal.id === id) Object.assign(m.deal, patch); })); (ui._deals || []).forEach(d => { if (d.id === id) Object.assign(d, patch); }); $$('.bpx-dealslot').forEach(s => { s._h = null; }); ui.decorateList(); }
  async function inlineDealClick(e) {                           // the list lives outside the sheet, so it needs its own handler
    const el = e.target.closest('.bpx-dealslot [data-a]'); if (!el) return;
    const a = el.dataset.a;
    try {
      if (a === 'dealtocompare') return dealToCompare(el.dataset.id);
      if (a === 'clip') { const v = el.dataset.v === '1'; await bp.deals.clip(el.dataset.id, v); patchCachedDeal(el.dataset.id, { clipped: v }); toast(tr(v ? 'clipped' : 'unclipped'), 'ok'); }
    } catch (err) { console.error(err); toast(errMsg(err), ''); }
  }

  async function renderDeals() {
    const [deals, best] = await Promise.all([bp.deals.list(), bestPrices()]);
    const lid = ui.host.activeListId();
    let matches = []; if (lid) { try { matches = await bp.deals.matchesForList(lid); } catch (e) { /* ignore */ } }
    const today = localISO(); ui._deals = deals;
    const seen = new Set(), matchedIds = new Set();
    const uniq = matches.filter(m => {
      const k = m.item_id + '|' + m.deal.id; if (seen.has(k)) return false; seen.add(k);
      const live = !m.deal.valid_to || m.deal.valid_to >= today; if (live) matchedIds.add(m.deal.id); return live;
    });
    // 1) Browse first: offers matched to the current list (or a plain-language empty state).
    let html = `<span class="bpx-lbl" style="margin-top:0">${h(tr('lbl_matches'))}</span>`;
    html += uniq.length
      ? uniq.map(m => dealCard(evalDeal(m.deal, best), { item: m.item_name, del: true })).join('') + `<div class="bpx-note">${h(tr('offers_scope_note'))}</div>`
      : `<div class="bpx-card bpx-empty">${h(tr('offers_empty'))}</div>`;
    // 2) Secondary actions: manual entry and CSV import stay collapsed until asked for.
    html += `<div class="bpx-row" style="margin:10px 0 8px">
      <button class="bpx-btn" data-a="toggle" data-t="dlAddPanel" aria-expanded="false" aria-controls="dlAddPanel">+ ${h(tr('act_add'))}</button>
      <button class="bpx-btn" data-a="toggle" data-t="dlImpPanel" aria-expanded="false" aria-controls="dlImpPanel">${h(tr('act_import'))}</button></div>
      <div class="bpx-card" id="dlAddPanel" hidden>
        <div class="bpx-grid"><input class="bpx-in" id="dlName" placeholder="${h(tr('ph_product'))}" aria-label="${h(tr('ph_product'))}" maxlength="200"><input class="bpx-in" id="dlStore" placeholder="${h(tr('ph_store'))}" aria-label="${h(tr('ph_store'))}" maxlength="120">
          <input class="bpx-in" id="dlPrice" inputmode="decimal" placeholder="${h(tr('ph_price'))}" aria-label="${h(tr('ph_price'))}">
          <div class="bpx-row" style="flex-wrap:nowrap"><input class="bpx-in" id="dlSize" inputmode="decimal" placeholder="${h(tr('ph_size'))}" aria-label="${h(tr('ph_size'))}"><select class="bpx-in" id="dlUnit" style="width:auto" aria-label="${h(tr('unit_aria'))}">${UNITS.map(u => `<option>${u}</option>`).join('')}</select></div></div>
        <details class="bpx-more" style="margin-top:10px"><summary>${h(tr('more_opts'))}</summary>
          <div class="bpx-grid"><select class="bpx-in" id="dlKind" aria-label="${h(tr('kind_ad'))} / ${h(tr('dc_coupon'))}"><option value="weekly_ad">${h(tr('kind_ad'))}</option><option value="coupon">${h(tr('kind_coupon'))}</option></select>
            <input class="bpx-in" id="dlQty" inputmode="decimal" placeholder="${h(tr('ph_qty'))}" aria-label="${h(tr('ph_qty'))}">
            <select class="bpx-in" id="dlDisc" aria-label="${h(tr('disc_none'))}"><option value="">${h(tr('disc_none'))}</option><option value="p">${h(tr('disc_p'))}</option><option value="d">${h(tr('disc_d'))}</option><option value="bogo">${h(tr('disc_bogo'))}</option></select>
            <input class="bpx-in" id="dlDv" inputmode="decimal" hidden><input class="bpx-in" id="dlGet" inputmode="numeric" placeholder="${h(tr('ph_get'))}" aria-label="${h(tr('ph_get'))}" hidden>
            <label class="bpx-sub" style="grid-column:1/-1">${h(tr('valid_until_aria'))}<input class="bpx-in" id="dlTo" type="date" style="margin-top:3px"></label></div>
          <div class="bpx-note">${h(tr('add_note'))}</div></details>
        <button class="bpx-btn p" data-a="adddeal" style="margin-top:8px">${h(tr('add_deal'))}</button></div>
      <div class="bpx-card" id="dlImpPanel" hidden><div class="bpx-name">${h(tr('import_sum'))}</div><div class="bpx-note" id="dlCsvHelp">${h(tr('import_help'))}</div>
        <pre class="bpx-csv-example" id="dlCsvExample">${h(tr('import_example'))}</pre>
        <textarea class="bpx-in" id="dlCsv" rows="4" placeholder="${h(tr('import_paste_ph'))}" aria-label="${h(tr('import_sum'))}" aria-describedby="dlCsvHelp dlCsvExample"></textarea><button class="bpx-btn" data-a="importdeals" style="margin-top:6px">${h(tr('import_btn'))}</button></div>`;
    // 3) Everything else that is saved and still valid.
    const rest = deals.filter(d => (!d.valid_to || d.valid_to >= today) && !matchedIds.has(d.id));
    if (rest.length) html += `<span class="bpx-lbl">${h(tr(uniq.length ? 'lbl_other' : 'lbl_all'))}</span>` + rest.map(d => dealCard(evalDeal(d, best), { del: true })).join('');
    body().innerHTML = html;
    const disc = $('#dlDisc');
    if (disc) disc.onchange = () => {                         // discount fields appear only when a discount type is chosen
      const v = disc.value, dv = $('#dlDv'), get = $('#dlGet');
      dv.hidden = !v; get.hidden = v !== 'bogo';
      dv.placeholder = v ? tr('ph_dv_' + v) : ''; dv.setAttribute('aria-label', dv.placeholder); dv.inputMode = v === 'bogo' ? 'numeric' : 'decimal';
    };
  }
  const num = id => { const v = parseFloat($(id).value); return isNaN(v) ? null : v; };
  async function submitDeal() {
    const disc = $('#dlDisc').value, d = {
      product_name: $('#dlName').value.trim(), store: $('#dlStore').value.trim(), kind: $('#dlKind').value, pkg_price: num('#dlPrice'),
      pkg_size: num('#dlSize'), pkg_qty: num('#dlQty') || 1, pkg_unit: $('#dlUnit').value, valid_to: $('#dlTo').value || null,
    };
    if (!d.product_name || d.pkg_price == null || !(d.pkg_size > 0)) return toast(tr('need_fields'));
    if (disc === 'p' || disc === 'd') { d.discount_type = disc; d.discount_value = num('#dlDv'); if (d.discount_value == null) return toast(tr('need_dv')); if (disc === 'p' && d.discount_value > 100) return toast(tr('pct_max')); }
    if (disc === 'bogo') { d.discount_type = 'bogo'; d.buy_qty = parseInt($('#dlDv').value, 10); d.get_qty = parseInt($('#dlGet').value, 10); if (!(d.buy_qty > 0 && d.get_qty > 0)) return toast(tr('need_bogo')); }
    await bp.deals.add(d); mcache.forEach(c => { c.at = 0; }); toast(tr('deal_added'), 'ok'); showTab('deals');
  }
  async function importDeals() {
    const csv = $('#dlCsv').value.trim(); if (!csv) return;
    const token = await ui.host.accessToken(); if (!token) return toast(tr('sign_in_again'));
    const r = await fetch('/api/deals-import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ csv }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error || tr('import_failed'));
    mcache.forEach(c => { c.at = 0; });
    toast(trn('imported', j.imported, { skip: j.skipped ? tr('skipped', { n: j.skipped }) : '' }), 'ok'); showTab('deals');
  }
  function dealToCompare(id) {
    const apply = deal => { const ok = ui.host.fillCard(bp.deals.toCard(deal)); if (ok) { closeSheet(); toast(tr('deal_on_card'), 'ok'); } else toast(tr('no_empty_card')); };
    const d = findDeal(id); if (d) return apply(d);
    bp.deals.matchesForList(ui.host.activeListId()).then(ms => { const m = ms.find(x => x.deal.id === id); if (m) apply(m.deal); });
  }

  /* ------------------------------ household ------------------------------ */
  async function renderHouse() {
    const hs = await bp.households.list(), me = bp.me(), lists = (ui.host.lists && ui.host.lists()) || [];
    let html = '';
    html += hs.length ? hs.map(x => {
      const owner = x.members.some(m => m.is_me && m.role === 'owner');
      return `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow bpx-name">${h(x.name)}</div>${owner ? `<button class="bpx-btn" data-a="invite" data-id="${h(x.id)}">${h(tr('invite'))}</button>` : ''}<button class="bpx-btn d" data-a="leave" data-id="${h(x.id)}">${h(tr('leave'))}</button></div>
        <div id="bpxInv${h(x.id)}"></div>
        <div class="bpx-note">${h(tr('member_access'))}</div>
        ${x.members.map(m => `<div class="bpx-row bpx-sub" style="justify-content:space-between"><span>${h(m.display_name)}${m.is_me ? ' ' + h(tr('you')) : ''} · ${h(tr(m.role === 'owner' ? 'owner' : 'member'))}</span>${owner && !m.is_me ? `<button class="bpx-btn d" style="padding:2px 8px" data-a="kick" data-hid="${h(x.id)}" data-uid="${h(m.user_id)}">${h(tr('remove'))}</button>` : ''}</div>`).join('')}</div>`;
    }).join('') : `<div class="bpx-note">${h(tr('hh_intro'))}</div>`;
    html += `<div class="bpx-card"><span class="bpx-lbl" style="margin-top:0">${h(tr('hh_create_lbl'))}</span><div class="bpx-row"><input class="bpx-in bpx-grow" id="hhName" maxlength="80" placeholder="${h(tr('hh_ph'))}"><button class="bpx-btn p" data-a="mkhouse">${h(tr('create'))}</button></div>
      <span class="bpx-lbl">${h(tr('join_lbl'))}</span><div class="bpx-row"><input class="bpx-in bpx-grow" id="hhCode" maxlength="16" autocapitalize="characters" placeholder="${h(tr('code_ph'))}"><button class="bpx-btn" data-a="joinhouse">${h(tr('join'))}</button></div></div>`;
    const mine = lists.filter(l => l.ownerId === me);
    if (hs.length && mine.length) {
      html += `<span class="bpx-lbl">${h(tr('share_lbl'))}</span>` + mine.map(l => `<div class="bpx-row" style="margin-bottom:6px"><span class="bpx-grow bpx-name">${h(l.name)}</span>
        <select class="bpx-in" style="width:auto" data-share="${h(l.id)}" aria-label="${h(tr('share_aria', { name: l.name }))}"><option value="">${h(tr('just_me'))}</option>${hs.map(x => `<option value="${h(x.id)}"${l.householdId === x.id ? ' selected' : ''}>${h(x.name)}</option>`).join('')}</select></div>`).join('');
    }
    body().innerHTML = html;
    $$('select[data-share]', body()).forEach(sel => sel.onchange = () => { try { bp.shareList(sel.dataset.share, sel.value || null); toast(tr(sel.value ? 'shared' : 'private'), 'ok'); } catch (e) { toast(e.message); } });
  }
  async function mkHouse() { const n = $('#hhName').value.trim(); if (!n) return toast(tr('need_hh_name')); await bp.households.create(n); toast(tr('hh_created'), 'ok'); showTab('house'); }
  async function joinHouse() { const c = $('#hhCode').value.trim(); if (!c) return toast(tr('need_code')); await bp.households.join(c); toast(tr('hh_joined'), 'ok'); showTab('house'); }

  /* ------------------------------ share THIS list (contextual flow) ------------------------------
   * Opened from the "Share list" button under the list header. Everything is about the active list: its state (private /
   * shared), then the three steps (household -> share -> invite), then who it is shared with and "Stop sharing".
   * The general Household tab (members, leave, per-list selectors) is untouched and reachable via "Manage household". */
  let shInvite = null, shOv = null;                          // shOv: optimistic householdId for ~5 s, until the projection catches up
  const curList = () => {
    const lid = ui.host.activeListId(); if (lid == null) return null;
    const l = ((ui.host.lists && ui.host.lists()) || []).find(x => String(x.id) === String(lid)); if (!l) return null;
    return shOv && String(shOv.id) === String(l.id) && Date.now() - shOv.at < 5000 ? Object.assign({}, l, { householdId: shOv.hid }) : l;
  };
  const isOwnerOf = x => x.members.some(m => m.is_me && m.role === 'owner');
  function inviteHtml(code) {
    return `<div class="bpx-note">${h(tr('invite_note'))}</div><div class="bpx-code" id="shCodeOut">${h(code)}</div>
      <div class="bpx-row" style="margin-top:6px"><button class="bpx-btn" data-a="shcopy">${h(tr('sh_copy'))}</button>${navigator.share ? `<button class="bpx-btn p" data-a="shsend">${h(tr('sh_send'))}</button>` : ''}</div>`;
  }
  async function openShareList() {
    if (!curList()) return toast(tr('rep_open_list'));
    shInvite = null; shOv = null;
    openSheet(tr('sh_title'), '', null);
    sheetEl.addEventListener('click', hubClick);
    sheetEl.addEventListener('submit', e => e.preventDefault());
    sheetEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('#shName,#shCode')) return;
      e.preventDefault(); const b = $(e.target.id === 'shName' ? '[data-a="shmk"]' : '[data-a="shjoin"]', sheetEl); if (b) b.click();
    });
    busy();
    try { await renderShare(); } catch (e) { fail(e); }
  }
  async function renderShare() {
    if (!sheetEl) return;
    const l = curList(); if (!l) return closeSheet();
    const hs = await bp.households.list(), me = bp.me();
    if (!sheetEl) return;
    const mine = l.ownerId === me, shared = !!l.householdId;
    const hh = shared ? hs.find(x => String(x.id) === String(l.householdId)) : null, hhName = hh ? hh.name : (hs[0] ? hs[0].name : '');
    const people = x => x.members.map(m => `<div class="bpx-row bpx-sub"><span>${h(m.display_name)}${m.is_me ? ' ' + h(tr('you')) : ''}${m.role === 'owner' ? ' · ' + h(tr('owner')) : ''}</span></div>`).join('');
    const step = (n, title, done, inner) => `<div class="bpx-step${done ? ' done' : ''}"><div class="bpx-stepn" aria-hidden="true">${done ? '&#10003;' : n}</div><div class="bpx-grow"><div class="bpx-name">${h(title)}${done ? `<span class="bpx-sr"> (${h(tr('sh_done'))})</span>` : ''}</div>${inner}</div></div>`;
    // a) Is it private or shared?
    let html = `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow"><div class="bpx-name">${h(l.name)}</div>
      <div class="bpx-sub">${h(shared ? tr('sh_status_shared', { name: hhName || tr('sh_chip_shared') }) : tr('sh_status_private'))}</div></div>
      <span class="bpx-chip ${shared ? 'g' : 'n'}">${h(tr(shared ? 'sh_chip_shared' : 'sh_chip_private'))}</span></div></div>`;
    if (!mine) {                                              // a list someone else shared with me: read-only
      html += `<div class="bpx-note">${h(tr('sh_owner_only'))}</div>` + (hh ? `<span class="bpx-lbl">${h(tr('sh_with_lbl'))}</span><div class="bpx-people">${people(hh)}</div>` : '')
        + `<div class="bpx-row" style="margin-top:10px"><button class="bpx-btn" data-a="shmanage">${h(tr('sh_manage'))}</button></div>`;
      body().innerHTML = html; return;
    }
    // b) Household: create or join when there is none.
    html += step(1, tr('sh_step1'), hs.length > 0, hs.length
      ? `<div class="bpx-sub">${h(hs.map(x => x.name).join(', '))}</div>`
      : `<div class="bpx-note">${h(tr('sh_hh_none'))}</div>
         <span class="bpx-lbl">${h(tr('hh_create_lbl'))}</span><div class="bpx-row"><input class="bpx-in bpx-grow" id="shName" maxlength="80" placeholder="${h(tr('hh_ph'))}" aria-label="${h(tr('hh_create_lbl'))}"><button class="bpx-btn p" data-a="shmk">${h(tr('sh_create_btn'))}</button></div>
         <span class="bpx-lbl">${h(tr('sh_join_lbl'))}</span><div class="bpx-row"><input class="bpx-in bpx-grow" id="shCode" maxlength="16" autocapitalize="characters" placeholder="${h(tr('code_ph'))}" aria-label="${h(tr('sh_join_lbl'))}"><button class="bpx-btn" data-a="shjoin">${h(tr('join'))}</button></div>`);
    // Share this list with a household.
    html += step(2, tr('sh_step2'), shared, shared ? `<div class="bpx-sub">${h(tr('sh_step2_done', { name: hhName }))}</div>`
      : hs.length === 0 ? `<div class="bpx-sub">${h(tr('sh_need_hh'))}</div>`
      : hs.length === 1 ? `<div class="bpx-row" style="margin-top:4px"><button class="bpx-btn p" data-a="shshare" data-id="${h(hs[0].id)}">${h(tr('sh_share_btn', { name: hs[0].name }))}</button></div>`
      : `<div class="bpx-row" style="margin-top:4px"><select class="bpx-in bpx-grow" id="shHh" aria-label="${h(tr('sh_step1'))}">${hs.map(x => `<option value="${h(x.id)}">${h(x.name)}</option>`).join('')}</select><button class="bpx-btn p" data-a="shshare">${h(tr('sh_share_sel'))}</button></div>`);
    // c) Invite someone.
    const target = hh || hs.find(isOwnerOf) || hs[0];
    html += step(3, tr('sh_step3'), false, !target ? `<div class="bpx-sub">${h(tr('sh_need_hh'))}</div>`
      : !isOwnerOf(target) ? `<div class="bpx-sub">${h(tr('sh_invite_owner_only'))}</div>`
      : `<div class="bpx-note">${h(tr('sh_invite_help'))}</div><button class="bpx-btn" data-a="shinvite" data-id="${h(target.id)}">${h(tr(shInvite && String(shInvite.hid) === String(target.id) ? 'sh_new_invite_btn' : 'sh_invite_btn'))}</button><div id="shInv">${shInvite && String(shInvite.hid) === String(target.id) ? inviteHtml(shInvite.code) : ''}</div>`);
    // d) Who can see it now + stop sharing.
    if (shared && hh) {
      html += `<span class="bpx-lbl">${h(tr('sh_with_lbl'))}</span><div class="bpx-people">${people(hh)}</div>` + (hh.members.length < 2 ? `<div class="bpx-note">${h(tr('sh_only_you'))}</div>` : '');
      html += `<div class="bpx-row" style="margin-top:10px"><button class="bpx-btn d" data-a="shstop">${h(tr('sh_stop'))}</button></div>`;
    } else if (shared) {
      html += `<div class="bpx-row" style="margin-top:10px"><button class="bpx-btn d" data-a="shstop">${h(tr('sh_stop'))}</button></div>`;
    }
    if (hs.length) html += `<div class="bpx-row" style="margin-top:8px"><button class="bpx-btn" data-a="shmanage">${h(tr('sh_manage'))}</button></div>`;
    body().innerHTML = html;
  }
  function shareNow(householdId) {                           // throws if I'm not the owner (server enforces it too)
    const l = curList(); bp.shareList(l.id, householdId || null); shOv = { id: l.id, hid: householdId || null, at: Date.now() };
  }
  async function shMake() {
    const n = $('#shName').value.trim(); if (!n) return toast(tr('need_hh_name'));
    const id = await bp.households.create(n); let ok = false;
    if (id) { try { shareNow(id); ok = true; } catch (e) { console.error(e); } }
    toast(tr(ok ? 'sh_created_shared' : 'hh_created'), 'ok'); await renderShare();
  }
  async function shJoin() { const c = $('#shCode').value.trim(); if (!c) return toast(tr('need_code')); await bp.households.join(c); toast(tr('hh_joined'), 'ok'); await renderShare(); }
  async function shShare(el) { const hid = el.dataset.id || ($('#shHh') || {}).value; if (!hid) return; shareNow(hid); toast(tr('shared'), 'ok'); await renderShare(); }
  async function shStop() { if (!confirm(tr('sh_stop_confirm'))) return; shareNow(null); shInvite = null; toast(tr('private'), 'ok'); await renderShare(); }
  async function shCopy() {
    const c = shInvite && shInvite.code; if (!c) return;
    try { await navigator.clipboard.writeText(c); toast(tr('sh_copied'), 'ok'); }
    catch (e) { const el = $('#shCodeOut'); if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = global.getSelection(); s.removeAllRanges(); s.addRange(r); } toast(tr('sh_copy_failed')); }
  }
  async function shSend() {
    const c = shInvite && shInvite.code; if (!c) return;
    try { await navigator.share({ title: 'Better Price', text: tr('sh_invite_msg', { code: c }), url: location.origin }); }
    catch (e) { if (e && e.name !== 'AbortError') return shCopy(); }
  }

  /* ------------------------------ replenish ------------------------------ */
  async function openReplenish() {
    const lid = ui.host.activeListId(); if (!lid) return toast(tr('rep_open_list'));
    const list = (ui.host.lists() || []).find(l => String(l.id) === String(lid));
    const b = openSheet(tr('rep_title'), `<div class="bpx-empty">${h(tr('loading'))}</div>`);
    try {
      const favs = await bp.favorites.list(list && list.householdId);
      const onList = new Set((ui.host.listItems(lid) || []).map(i => bp.normKey(i.name)));
      const rows = favs.filter(f => !onList.has(f.name_key));
      b.innerHTML = rows.length ? `<div class="bpx-note">${h(tr('rep_note'))}</div>${rows.map((f, i) => `<label class="bpx-card bpx-row"><input type="checkbox" data-i="${i}"${f.pinned || f.add_count > 1 ? ' checked' : ''}>
        <span class="bpx-grow"><span class="bpx-name">${h(f.name)}</span><br><span class="bpx-sub">${h(tr('rep_bought', { n: f.add_count, date: fmtDate(f.last_added_at.slice(0, 10)) }))}${f.default_store ? ' · ' + h(f.default_store) : ''}</span></span>
        <button class="bpx-btn" data-pin="${h(f.id)}" data-v="${f.pinned ? 0 : 1}" aria-label="${h(tr(f.pinned ? 'unpin_aria' : 'pin_aria', { name: f.name }))}">${h(tr(f.pinned ? 'unpin' : 'pin'))}</button>
        <button class="bpx-btn d" data-hide="${h(f.id)}" aria-label="${h(tr('hide_aria', { name: f.name }))}">&#10005;</button></label>`).join('')}
        <button class="bpx-btn p" id="bpxAddFav" style="width:100%;margin-top:8px">${h(tr('rep_add'))}</button>` : `<div class="bpx-empty">${h(tr('rep_empty_1'))}<br>${h(tr('rep_empty_2'))}</div>`;
      b.onclick = async e => {
        const pin = e.target.closest('[data-pin]'), hide = e.target.closest('[data-hide]');
        if (pin) { e.preventDefault(); await bp.favorites.pin(pin.dataset.pin, pin.dataset.v === '1'); return openReplenish(); }
        if (hide) { e.preventDefault(); await bp.favorites.hide(hide.dataset.hide); return openReplenish(); }
        if (e.target.id === 'bpxAddFav') {
          const chosen = rows.filter((f, i) => b.querySelector(`[data-i="${i}"]`).checked).map(f => ({ name: f.name, qty: f.default_qty, store: f.default_store }));
          const n = ui.host.addItems(chosen); closeSheet(); toast(n ? trn('added', n) : tr('nothing_sel'), n ? 'ok' : '');
        }
      };
    } catch (e) { fail(e); }
  }
  ui.openReplenish = openReplenish; ui.openHub = openHub; ui.openShareList = openShareList;
})(window);
