import sys, os, re, json, gzip, datetime, heapq

HEADER = re.compile(r'^(\d{4}-\d{2}-\d{2}[T ]\S+)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(.*)$')

def category(message):
    text = re.split(r'\s+payload\w*=', message, maxsplit=1)[0].lower()
    explicit = re.search(r'\bcategoria=([a-z_]+)', text)
    if explicit and explicit.group(1).upper() in ['PEDIDOS','CAMPANHAS_ARQUIVOS','AUTENTICACAO_API','REQUISICOES_API','INFRAESTRUTURA','APLICACAO']:
        return explicit.group(1).upper()
    if any(term in text for term in ['outofmemory','out of memory','native thread','pthread_create','too many open files','no space left']):
        return 'INFRAESTRUTURA'
    if any(term in text for term in ['autentic','token_invalido','credenciais','login','unauthorized']):
        return 'AUTENTICACAO_API'
    if 'json de campanha' in text or 'bucket' in text or 'arquivo' in text:
        return 'CAMPANHAS_ARQUIVOS'
    if 'categoria=requisicoes_api' in text or 'requisi' in text or 'json inv' in text:
        return 'REQUISICOES_API'
    if 'pedido' in text or 'carrinho' in text:
        return 'PEDIDOS'
    return 'APLICACAO'

def events(stream, filename):
    current = None
    for line_number, line in enumerate(stream, 1):
        line = line.rstrip('\r\n')
        match = HEADER.match(line)
        if match:
            if current:
                yield current
            stamp, level, rest = match.groups()
            message = rest.split(' : ', 1)[-1]
            trace = re.search(r'\brastreio=([^\s]+)', rest)
            fields = dict(re.findall(r'\b([a-zA-Z_][a-zA-Z_0-9]*)=([^\s,{}]+)', message))
            summary = re.split(r'\s+payload(?:Recebido|Sigrede|Retorno)?=', message, maxsplit=1)[0]
            current = dict(id=filename+':'+str(line_number), data=stamp.replace(' ', 'T'),
                           nivel=level, categoria=category(message), mensagem=summary[:400], arquivo=filename,
                           rastreio=trace.group(1) if trace and trace.group(1)!='sem-rastreio' else None,
                           pedido=fields.get('pedidoIntegrador') or fields.get('pedidoCotefacil') or fields.get('pedidoCliente') or fields.get('pedido'),
                           campanha=fields.get('idCampanha') or fields.get('idOl'),
                           rota=fields.get('rota'), usuario=fields.get('usuarioInformado') or fields.get('username'),
                           duracaoMs=fields.get('duracaoMs'), statusHttp=fields.get('statusHttp'), motivo=fields.get('motivo'), detalhes=line,
                           linhas=1)
        elif current:
            current['detalhes'] += '\n'+line
            current['linhas'] += 1
    if current:
        yield current

def query(args):
    path = os.path.abspath(args['path'])
    folder, name = os.path.split(path)
    stem = name[:-4] if name.endswith('.log') else name
    pattern = re.compile(re.escape(stem)+r'-(\d{4}-\d{2}-\d{2})\.(\d+)\.log(?:\.gz)?$')
    files = []
    for item in os.scandir(folder):
        if not item.is_file(follow_symlinks=False):
            continue
        match = pattern.fullmatch(item.name)
        if item.name == name or match:
            files.append(item.path)
    page = max(1, min(int(args.get('page') or 1), 10000))
    limit = max(1, min(int(args.get('limit') or 50), 200))
    offset = (page-1)*limit
    heap = []
    total = 0
    warnings = []
    start = args.get('dataInicio') or ''
    end = args.get('dataFim') or ''
    levels = args.get('niveis') or ([args['nivel']] if args.get('nivel') else (['ERROR'] if args.get('somenteErros') else []))
    categories = args.get('categorias') or []
    filters = [(key, str(args.get(key) or '').strip().lower()) for key in ['search','rastreio','pedido','campanha']]
    first = None
    last = None
    for file in sorted(files):
        try:
            opener = gzip.open if file.endswith('.gz') else open
            with opener(file, 'rt', encoding='utf-8', errors='replace') as stream:
                for event in events(stream, os.path.basename(file)):
                    day = event['data'][:10]
                    first = min(first, event['data']) if first else event['data']
                    last = max(last, event['data']) if last else event['data']
                    if (start and day < start) or (end and day > end) or (levels and event['nivel'] not in levels) or (categories and event['categoria'] not in categories):
                        continue
                    if any(value and value not in str(event.get(key) or (event['detalhes'] if key=='search' else '')).lower() for key,value in filters):
                        continue
                    total += 1
                    # Preserve somente a pagina necessaria em memoria; percorre todo o historico.
                    rank = (event['data'], event['arquivo'], int(event['id'].rsplit(':',1)[1]))
                    item = (rank, event)
                    if len(heap) < offset+limit:
                        heapq.heappush(heap,item)
                    elif rank > heap[0][0]:
                        heapq.heapreplace(heap,item)
        except (OSError, EOFError) as error:
            warnings.append(os.path.basename(file)+': '+str(error))
    selected = [event for _,event in sorted(heap, key=lambda item:item[0], reverse=True)[offset:offset+limit]]
    return dict(data=selected, meta=dict(page=page,limit=limit,total=total,totalPages=max(1,(total+limit-1)//limit),
                arquivos=[os.path.basename(f) for f in files],primeiroRegistro=first,ultimoRegistro=last,
                avisos=warnings,parcial=bool(warnings)), arquivo=dict(path=path,existe=bool(files),source='historico-api'))

if __name__ == '__main__':
    try:
        print(json.dumps(query(json.loads(sys.argv[1])),ensure_ascii=False))
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
