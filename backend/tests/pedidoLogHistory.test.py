import sys, os, base64, types, tempfile, gzip, unittest, pathlib
source = base64.b64decode(sys.argv[1]).decode() if len(sys.argv)>1 else (pathlib.Path(__file__).parent.parent/'pedidoLogHistory.py').read_text(encoding='utf8')
module = types.ModuleType('history_test_subject')
exec(compile(source,'pedidoLogHistory.py','exec'),module.__dict__)
class HistoryTests(unittest.TestCase):
    def test_archives_levels_and_pagination(self):
        with tempfile.TemporaryDirectory() as folder:
            current=os.path.join(folder,'integracao-pedidos.log')
            with open(current,'w') as file:
                file.write('2026-10-16T12:00:00.000-03:00 INFO [main] rastreio=abc Logger : Pedido inserido pedidoCotefacil=123 numeroCarrinho=456\n')
                file.write('2026-10-16T12:01:00.000-03:00 ERROR [main] rastreio=xyz Logger : Falha no pedido idCampanha=77 payloadRecebido={"teste":true}\n at Example.method(Test.java:1)\nCaused by: ExampleException\n')
                file.write('2026-10-16T12:02:00.000-03:00 INFO [main] rastreio=ok Logger : Finalizado sem erro\n')
            with gzip.open(os.path.join(folder,'integracao-pedidos-2026-10-15.0.log.gz'),'wt') as file:
                file.write('2026-10-15T12:00:00.000-03:00 WARN [main] rastreio=old Logger : Arquivo ausente idCampanha=88\n')
            result=module.query(dict(path=current,limit=2))
            self.assertEqual(result['meta']['total'],4)
            self.assertEqual(module.query(dict(path=current,niveis=['WARN','ERROR']))['meta']['total'],2)
            self.assertEqual(module.query(dict(path=current,categorias=['CAMPANHAS_ARQUIVOS']))['meta']['total'],1)
            self.assertEqual(module.query(dict(path=current,niveis=['ERROR'],categorias=['CAMPANHAS_ARQUIVOS']))['meta']['total'],0)
            self.assertEqual(module.category('Falha categoria=REQUISICOES_API payloadRecebido={\"login\":\"x\"}'),'REQUISICOES_API')
            self.assertEqual(len(result['data']),2)
            error=module.query(dict(path=current,nivel='ERROR'))['data'][0]
            self.assertEqual(error['linhas'],3)
            self.assertIn('ExampleException',error['detalhes'])
            self.assertNotIn('payloadRecebido',error['mensagem'])
            self.assertEqual(error['campanha'],'77')
            self.assertEqual(module.query(dict(path=current,nivel='ERROR'))['meta']['total'],1)
            self.assertEqual(module.query(dict(path=current,rastreio='xyz'))['meta']['total'],1)
            self.assertEqual(module.query(dict(path=current,pedido='123'))['meta']['total'],1)
            older=module.query(dict(path=current,dataFim='2026-10-15'))
            self.assertEqual(older['meta']['total'],1)
            self.assertTrue(older['data'][0]['arquivo'].endswith('.gz'))
            page2=module.query(dict(path=current,page=2,limit=2))
            self.assertEqual(page2['data'][-1]['nivel'],'WARN')
            self.assertEqual(module.query(dict(path=current,search='ExampleException'))['meta']['total'],1)
            with open(os.path.join(folder,'integracao-pedidos-2026-10-14.0.log.gz'),'w') as file: file.write('corrompido')
            self.assertTrue(module.query(dict(path=current))['meta']['parcial'])
if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
