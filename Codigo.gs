/**
 * Physique Pro — Backend Google Apps Script
 * VERSION: 2026-09-17-db-v7
 *
 * Banco central do app:
 * - Medidas
 * - Rotina (agora com sono e humor)
 * - Recuperacao
 * - Prato
 * - Scans (metadados; fotos continuam locais por enquanto)
 * - Perfil
 * - Hevy somente leitura via Script Properties (HEVY_API_KEY)
 *
 * INSTALAÇÃO
 * 1. Cole este arquivo no projeto Apps Script ligado à planilha.
 * 2. Salve.
 * 3. Execute setupDatabase() uma vez pelo editor e autorize.
 *    (Isso cria as colunas 'sono' e 'humor' na aba Rotina sem apagar nada.)
 * 4. Implantar > Gerenciar implantações > Editar > Nova versão > Implantar.
 * 5. Continue usando a mesma URL /exec no Physique Pro.
 */

var VERSION='2026-09-17-db-v7';
var HEVY_BASE='https://api.hevyapp.com/v1';

var MEDIDAS_CANON=['id','data','peso','altura','pescoco','cintura','abdomen','quadril','peito','ombros',
  'bicepsD','bicepsE','antD','antE','coxaD','coxaE','panD','panE','gordura','massaMagra','ffmi','notas'];

var DATASETS={
  rotina:{sheet:'Rotina',headers:['id','data','primeiraRefeicao','ultimaRefeicao','refeicoes','agua','sono','humor','energia','fome','digestao','ovos','whey','albumina','frango','carne','feijao','arroz','aveia','proteinaTotal','notas','updatedAt']},
  recuperacao:{sheet:'Recuperacao',headers:['id','data','sono','energia','recuperacao','treino','updatedAt']},
  prato:{sheet:'Prato',headers:['id','data','veg','prot','carb','hid','variedade','score','updatedAt']},
  scan:{sheet:'Scans',headers:['id','data','frontScore','sideScore','backScore','avgScore','comparabilidade','notas','updatedAt']},
  perfil:{sheet:'Perfil',headers:['id','altura','reminderInterval','reminderTime','goalsJson','updatedAt']}
};

function _norm(h){
  return String(h==null?'':h).toLowerCase()
    .replace(/[áàâã]/g,'a').replace(/[éèê]/g,'e').replace(/[íì]/g,'i')
    .replace(/[óòôõ]/g,'o').replace(/[úùû]/g,'u').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,'');
}
var ALIAS={
  id:'id',data:'data',peso:'peso',altura:'altura',pescoco:'pescoco',cintura:'cintura',
  abdomen:'abdomen',quadril:'quadril',peito:'peito',ombros:'ombros',
  bicepsd:'bicepsD',bicepse:'bicepsE',antd:'antD',ante:'antE',
  antebracodireito:'antD',antebracoesquerdo:'antE',
  coxad:'coxaD',coxae:'coxaE',coxadireita:'coxaD',coxaesquerda:'coxaE',
  pand:'panD',pane:'panE',panturrilhad:'panD',panturrilhae:'panE',
  panturrilhadireita:'panD',panturrilhaesquerda:'panE',
  gordura:'gordura',massamagra:'massaMagra',ffmi:'ffmi',notas:'notas'
};
function _canonOf(header){return ALIAS[_norm(header)]||null;}
function _ss(){return SpreadsheetApp.getActiveSpreadsheet();}
function _num(v){if(v===''||v==null)return null;var n=parseFloat(String(v).replace(',','.'));return isNaN(n)?null:n;}
function _dateKey(d){return Utilities.formatDate(d,Session.getScriptTimeZone()||'America/Sao_Paulo','yyyy-MM-dd');}
function _jsonValue(v,key){if(v instanceof Date){if(key==='data')return _dateKey(v);return v.toISOString();}return v;}
function _safeErr(err){var s=String(err&&err.message?err.message:err||'Erro');s=s.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/ig,'[credencial ocultada]');return s.slice(0,300);}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}

function _calcBF(peso,alt,pesc,cin){
  if(!pesc||!cin||!alt||!peso||cin<=pesc)return null;
  var v=495/(1.0324-0.19077*(Math.log(cin-pesc)/Math.LN10)+0.15456*(Math.log(alt)/Math.LN10))-450;
  if(isNaN(v)||v<3||v>55)return null;return Math.round(v*10)/10;
}
function _calcLBM(peso,bf){return bf==null?null:Math.round(peso*(1-bf/100)*10)/10;}
function _calcFFMI(peso,alt,bf){if(!peso||!alt||bf==null)return null;var h=alt/100;return Math.round((peso*(1-bf/100)/(h*h))*10)/10;}

function doGet(e){return handle(e);}
function doPost(e){return handle(e);}
function handle(e){
  var lock=LockService.getScriptLock();try{lock.waitLock(20000);}catch(err){}
  try{
    var action=(e&&e.parameter&&e.parameter.action)||'',body={};
    if(e&&e.postData&&e.postData.contents){try{body=JSON.parse(e.postData.contents);}catch(err){body={};}}
    if(body.action)action=body.action;

    if(action==='status')return json({success:true,_version:VERSION,datasets:Object.keys(DATASETS).concat(['medidas'])});
    if(action==='bootstrap')return json({success:true,medidas:_readMedidas(),rotina:_readSimple(DATASETS.rotina),recuperacao:_readSimple(DATASETS.recuperacao),prato:_readSimple(DATASETS.prato),scans:_readSimple(DATASETS.scan),perfil:_readSimple(DATASETS.perfil),_version:VERSION});
    if(action==='get')return json({success:true,registros:_readMedidas(),_version:VERSION});
    if(action==='upsert')return json(_upsertMedida(body));
    if(action==='delete')return json(_deleteMedida(body));

    if(action==='hevy_status')return json({success:true,connected:!!_hevyKey(),_version:VERSION});
    if(action==='hevy_workouts'){
      var days=parseInt((e&&e.parameter&&e.parameter.days)||'70',10);if(isNaN(days))days=70;days=Math.max(7,Math.min(180,days));
      var hw=_hevyWorkouts(days);hw._version=VERSION;return json(hw);
    }

    var parsed=_parseDatasetAction(action);
    if(parsed){
      var cfg=DATASETS[parsed.name];
      if(parsed.op==='get')return json({success:true,registros:_readSimple(cfg),_version:VERSION});
      if(parsed.op==='upsert')return json(_upsertSimple(cfg,body));
      if(parsed.op==='delete')return json(_deleteSimple(cfg,body));
    }
    return json({success:false,error:'no action',_version:VERSION});
  }catch(err){return json({success:false,error:_safeErr(err),_version:VERSION});}
  finally{try{lock.releaseLock();}catch(e2){}}
}

function _parseDatasetAction(action){
  var map={
    routine_get:['rotina','get'],routine_upsert:['rotina','upsert'],routine_delete:['rotina','delete'],
    recovery_get:['recuperacao','get'],recovery_upsert:['recuperacao','upsert'],recovery_delete:['recuperacao','delete'],
    plate_get:['prato','get'],plate_upsert:['prato','upsert'],plate_delete:['prato','delete'],
    scan_get:['scan','get'],scan_upsert:['scan','upsert'],scan_delete:['scan','delete'],
    profile_get:['perfil','get'],profile_upsert:['perfil','upsert'],profile_delete:['perfil','delete']
  };
  var x=map[action];return x?{name:x[0],op:x[1]}:null;
}

function _ensureMedidasSheet(){
  var ss=_ss(),sheet=ss.getSheetByName('Medidas')||ss.insertSheet('Medidas');
  if(sheet.getLastRow()===0){sheet.appendRow(MEDIDAS_CANON);sheet.setFrozenRows(1);}
  var lastCol=Math.max(sheet.getLastColumn(),1),hdr=sheet.getRange(1,1,1,lastCol).getValues()[0].map(function(h){return String(h).trim();}),present={};
  hdr.forEach(function(h){var c=_canonOf(h);if(c)present[c]=true;});
  var missing=MEDIDAS_CANON.filter(function(c){return !present[c];});
  if(missing.length){sheet.getRange(1,lastCol+1,1,missing.length).setValues([missing]);hdr=hdr.concat(missing);}
  sheet.setFrozenRows(1);return{sheet:sheet,headers:hdr};
}
function _readMedidas(){
  var st=_ensureMedidasSheet(),sheet=st.sheet,hdr=st.headers,lastCol=hdr.length,out=[];if(sheet.getLastRow()<=1)return out;
  var rows=sheet.getRange(2,1,sheet.getLastRow()-1,lastCol).getValues();
  rows.forEach(function(row){var obj={};for(var c=0;c<hdr.length;c++){var key=_canonOf(hdr[c])||hdr[c],val=_jsonValue(row[c],key);if(obj[key]===undefined||obj[key]==='')obj[key]=val;}if(obj.data||obj.peso)out.push(obj);});return out;
}
function _upsertMedida(body){
  var st=_ensureMedidasSheet(),sheet=st.sheet,hdr=st.headers,lastCol=hdr.length,idx={};for(var c=0;c<hdr.length;c++){var k=_canonOf(hdr[c]);if(k)idx[k]=c;}
  var id=String(body.id||body.data||new Date().getTime());body.id=id;if(!body.data)body.data=_dateKey(new Date());
  var bf=_calcBF(_num(body.peso),_num(body.altura),_num(body.pescoco),_num(body.cintura));
  if((body.gordura===undefined||body.gordura===''||+body.gordura===0)&&bf!=null)body.gordura=bf;
  if((body.massaMagra===undefined||body.massaMagra===''||+body.massaMagra===0)&&bf!=null)body.massaMagra=_calcLBM(_num(body.peso),bf);
  if((body.ffmi===undefined||body.ffmi===''||+body.ffmi===0)&&bf!=null)body.ffmi=_calcFFMI(_num(body.peso),_num(body.altura),bf);
  var rowIdx=_findRowByValue(sheet,(idx.id==null?0:idx.id)+1,id),existing=rowIdx>0?sheet.getRange(rowIdx,1,1,lastCol).getValues()[0]:null;
  var rowData=hdr.map(function(h,ci){var key=_canonOf(h);if(key&&body[key]!==undefined&&body[key]!==null)return body[key];return existing?existing[ci]:'';});
  if(rowIdx>0)sheet.getRange(rowIdx,1,1,lastCol).setValues([rowData]);else sheet.appendRow(rowData);
  return{success:true,updated:rowIdx>0,id:id,_version:VERSION};
}
function _deleteMedida(body){
  var st=_ensureMedidasSheet(),sheet=st.sheet,hdr=st.headers,idCol=0;for(var c=0;c<hdr.length;c++){if(_canonOf(hdr[c])==='id'){idCol=c;break;}}
  var id=String(body.id||'');if(!id)return{success:false,error:'id required',_version:VERSION};
  var row=_findRowByValue(sheet,idCol+1,id);if(row>1)sheet.deleteRow(row);return{success:true,deleted:row>1,_version:VERSION};
}

function _ensureSimpleSheet(cfg){
  var ss=_ss(),sheet=ss.getSheetByName(cfg.sheet)||ss.insertSheet(cfg.sheet);
  if(sheet.getLastRow()===0){sheet.appendRow(cfg.headers);sheet.setFrozenRows(1);return sheet;}
  var lastCol=Math.max(sheet.getLastColumn(),1),hdr=sheet.getRange(1,1,1,lastCol).getValues()[0].map(function(h){return String(h).trim();}),present={};hdr.forEach(function(h){present[h]=true;});
  var missing=cfg.headers.filter(function(h){return !present[h];});if(missing.length)sheet.getRange(1,lastCol+1,1,missing.length).setValues([missing]);sheet.setFrozenRows(1);return sheet;
}
function _readSimple(cfg){
  var sheet=_ensureSimpleSheet(cfg),lastRow=sheet.getLastRow();if(lastRow<=1)return[];
  var lastCol=sheet.getLastColumn(),hdr=sheet.getRange(1,1,1,lastCol).getValues()[0].map(String),rows=sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  return rows.map(function(row){var o={};hdr.forEach(function(k,i){o[k]=_jsonValue(row[i],k);});return o;}).filter(function(o){return o.id||o.data;});
}
function _upsertSimple(cfg,body){
  var sheet=_ensureSimpleSheet(cfg),hdr=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String),id=String(body.id||body.data||new Date().getTime());
  body.id=id;if(!body.data&&cfg.sheet!=='Perfil')body.data=_dateKey(new Date());body.updatedAt=new Date().toISOString();
  var idCol=hdr.indexOf('id');if(idCol<0)throw new Error('Cabecalho id ausente em '+cfg.sheet);
  var rowIdx=_findRowByValue(sheet,idCol+1,id),existing=rowIdx>0?sheet.getRange(rowIdx,1,1,hdr.length).getValues()[0]:null;
  var rowData=hdr.map(function(k,i){if(body[k]!==undefined&&body[k]!==null)return body[k];return existing?existing[i]:'';});
  if(rowIdx>0)sheet.getRange(rowIdx,1,1,hdr.length).setValues([rowData]);else sheet.appendRow(rowData);
  return{success:true,updated:rowIdx>0,id:id,_version:VERSION};
}
function _deleteSimple(cfg,body){
  var sheet=_ensureSimpleSheet(cfg),hdr=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String),id=String(body.id||body.data||'');
  if(!id)return{success:false,error:'id or data required',_version:VERSION};
  var idCol=hdr.indexOf('id');if(idCol<0)return{success:false,error:'id column missing',_version:VERSION};
  var row=_findRowByValue(sheet,idCol+1,id);if(row>1)sheet.deleteRow(row);return{success:true,deleted:row>1,_version:VERSION};
}
function _findRowByValue(sheet,col,value){
  if(sheet.getLastRow()<=1)return-1;var vals=sheet.getRange(2,col,sheet.getLastRow()-1,1).getValues();
  for(var i=0;i<vals.length;i++)if(String(vals[i][0])===String(value))return i+2;return-1;
}

function _hevyKey(){try{return String(PropertiesService.getScriptProperties().getProperty('HEVY_API_KEY')||'').trim();}catch(e){return'';}}
function _hevyGet(path,params){
  var key=_hevyKey();if(!key)throw new Error('Hevy não configurado. Adicione HEVY_API_KEY em Script Properties.');
  var q=[];params=params||{};Object.keys(params).forEach(function(k){if(params[k]!==undefined&&params[k]!==null)q.push(encodeURIComponent(k)+'='+encodeURIComponent(params[k]));});
  var url=HEVY_BASE+path+(q.length?'?'+q.join('&'):'');var res=UrlFetchApp.fetch(url,{method:'get',headers:{'api-key':key},muteHttpExceptions:true,followRedirects:true});
  var code=res.getResponseCode(),txt=res.getContentText();if(code<200||code>=300)throw new Error('Hevy respondeu HTTP '+code+'.');try{return JSON.parse(txt);}catch(e){throw new Error('Resposta inválida do Hevy.');}
}
function _hevyTemplateMap(){
  var cache=CacheService.getScriptCache(),cached=cache.get('hevy_template_map_v5');if(cached){try{return JSON.parse(cached);}catch(e){}}
  var map={},page=1,maxPages=15;while(page<=maxPages){var d=_hevyGet('/exercise_templates',{page:page,pageSize:100}),arr=d.exercise_templates||[];arr.forEach(function(t){var id=String(t.id||t.exercise_template_id||'');if(id)map[id]={title:t.title||'',muscle_group:t.muscle_group||t.primary_muscle_group||'',other_muscles:t.other_muscles||t.secondary_muscle_groups||[]};});if(page>=(d.page_count||1))break;page++;}
  try{cache.put('hevy_template_map_v5',JSON.stringify(map),21600);}catch(e){}return map;
}
function _hevyWorkouts(days){
  try{
    if(!_hevyKey())return{success:false,error:'Hevy não configurado no Apps Script.'};
    var cut=Date.now()-days*86400000,all=[],page=1,maxPages=25,done=false;
    while(page<=maxPages&&!done){var d=_hevyGet('/workouts',{page:page,pageSize:10}),ws=d.workouts||[];for(var i=0;i<ws.length;i++){var ts=Date.parse(ws[i].start_time||ws[i].created_at||'');if(ts&&!isNaN(ts)&&ts<cut){done=true;continue;}all.push(ws[i]);}if(page>=(d.page_count||1))break;page++;}
    var tm={};try{tm=_hevyTemplateMap();}catch(e){tm={};}
    var safe=all.map(function(w){return{id:w.id||'',title:w.title||'Treino',routine_id:w.routine_id||'',start_time:w.start_time||'',end_time:w.end_time||'',exercises:(w.exercises||[]).map(function(ex){var tid=String(ex.exercise_template_id||''),meta=tm[tid]||{};return{title:ex.title||meta.title||'Exercício',exercise_template_id:tid,muscle_group:meta.muscle_group||'',other_muscles:meta.other_muscles||[],sets:(ex.sets||[]).map(function(st){return{type:st.type||'normal',weight_kg:st.weight_kg==null?null:st.weight_kg,reps:st.reps==null?null:st.reps,rpe:st.rpe==null?null:st.rpe};})};})};});
    return{success:true,source:'hevy',workouts:safe};
  }catch(e){return{success:false,error:_safeErr(e)};}
}

function setupDatabase(){
  _ensureMedidasSheet();Object.keys(DATASETS).forEach(function(k){_ensureSimpleSheet(DATASETS[k]);});
  Logger.log('Banco pronto: Medidas, Rotina, Recuperacao, Prato, Scans e Perfil. Versão '+VERSION);return true;
}

function repararPlanilha(){
  var ss=_ss(),sheet=ss.getSheetByName('Medidas');if(!sheet)throw new Error("Aba 'Medidas' não encontrada.");
  var lastRow=sheet.getLastRow(),lastCol=sheet.getLastColumn();if(lastRow<1)return;
  var stamp=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd_HHmm');sheet.copyTo(ss).setName('Medidas_backup_'+stamp);
  var values=sheet.getRange(1,1,lastRow,lastCol).getValues(),hdr=values[0],srcCols={};
  for(var c=0;c<hdr.length;c++){var k=_canonOf(hdr[c]);if(k)(srcCols[k]=srcCols[k]||[]).push(c);}
  var out=[MEDIDAS_CANON.slice()];
  for(var r=1;r<values.length;r++){
    var row=values[r],rec={};MEDIDAS_CANON.forEach(function(k){var cols=srcCols[k]||[],v='';for(var i=0;i<cols.length;i++){if(row[cols[i]]!==''&&row[cols[i]]!=null){v=row[cols[i]];break;}}rec[k]=v;});
    if(!rec.data&&!rec.peso)continue;
    var peso=_num(rec.peso),alt=_num(rec.altura),pesc=_num(rec.pescoco),cin=_num(rec.cintura),bf=_calcBF(peso,alt,pesc,cin);
    if(bf!=null){if(_num(rec.gordura)==null||+rec.gordura===0)rec.gordura=bf;if(_num(rec.massaMagra)==null||+rec.massaMagra===0)rec.massaMagra=_calcLBM(peso,_num(rec.gordura));if(_num(rec.ffmi)==null||+rec.ffmi===0)rec.ffmi=_calcFFMI(peso,alt,_num(rec.gordura));}
    out.push(MEDIDAS_CANON.map(function(k){return rec[k]===undefined?'':rec[k];}));
  }
  sheet.clear();sheet.getRange(1,1,out.length,MEDIDAS_CANON.length).setValues(out);sheet.setFrozenRows(1);Logger.log('Medidas reparadas. Linhas preservadas: '+(out.length-1));
}
