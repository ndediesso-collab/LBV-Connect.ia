# coding: utf-8
"""Tests hors-ligne du transformateur (ne touche pas aux fichiers ORIA)."""
import ast
import inspect
import unittest
from pathlib import Path
import appliquer_correctif as patch

class TestOriaUX(unittest.TestCase):
    def test_python_syntax(self):
        ast.parse(Path(patch.__file__).read_text(encoding='utf-8'))

    def test_unicity_guard(self):
        with self.assertRaises(ValueError):
            patch.replace_once('aa aa', 'aa', 'b', 'test')

    def test_backend_helper_python_syntax(self):
        src=inspect.getsource(patch.backend)
        # The code is a Python string literal embedded in the transform;
        # extract and parse the standalone helper without importing backend dependencies.
        tree=ast.parse(src)
        helper=None
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id=='helper':
                helper=ast.literal_eval(node.value)
        self.assertIsNotNone(helper)
        ast.parse(helper)
        self.assertIn('"url": url if valid_url and wait == 0 else None', helper)
        self.assertNotIn('create_chariow_checkout(', helper)

    def test_expected_files_only(self):
        self.assertEqual(len(patch.FILES),6)
        self.assertEqual(set(patch.FILES),set(patch.TRANSFORMS))
        self.assertNotIn('Backend/app/services/payment_service.py',patch.FILES)
        self.assertNotIn('mobile/src/app/packs/index.tsx',patch.FILES)

def test_all_transformations_against_exact_anchors():
    """Every replacement is exercised using the anchor literals in the installer."""
    script = ast.parse(Path(patch.__file__).read_text(encoding='utf-8'))
    seen = []
    for node in script.body:
        if not isinstance(node, ast.FunctionDef) or node.name not in {
            'mobile_register','web_register','mobile_chat','web_chat','web_packs','backend'}:
            continue
        strings = []
        env = {}
        for stmt in node.body:
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                target = stmt.targets[0].id
                if isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
                    env[target]=stmt.value.value
                elif isinstance(stmt.value, ast.Call) and isinstance(stmt.value.func,ast.Name):
                    if stmt.value.func.id == 'replace_once':
                        arg=stmt.value.args[1]
                        strings.append(env[arg.id] if isinstance(arg, ast.Name) else ast.literal_eval(arg))
                    elif stmt.value.func.id=='replace_between':
                        for name in ('start','end'):
                            if name in env:strings.append(env[name])
        synthetic='\n\n'.join(strings)
        if node.name == 'web_packs':
            synthetic += """
      const response = await fetch(
        `${apiUrl}/payments/checkout`,
        { method: "POST", body: JSON.stringify({ provider: "chariow" }) },
      );
      window.alert(
        error instanceof Error
          ? error.message
          : "Impossible d'initialiser le paiement.",
      );
"""
        try:
            output=getattr(patch,node.name)(synthetic)
        except ValueError as e:
            raise AssertionError(f'Transformation {node.name} failed: {e}; strings={len(strings)}') from e
        assert output != synthetic, node.name
        seen.append((node.name,len(strings)))
    assert len(seen)==6,seen
    print('Synthetic anchor tests:',seen)

class TestTransformationAnchors(unittest.TestCase):
    def test_exact_transformation_anchors(self):
        test_all_transformations_against_exact_anchors()

if __name__ == '__main__':
    unittest.main()
