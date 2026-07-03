export function PageHeader({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-heading font-bold text-preto">{titulo}</h1>
        {descricao && (
          <p className="text-sm text-cinza-medio mt-1">{descricao}</p>
        )}
      </div>
      {acao && <div className="flex-shrink-0">{acao}</div>}
    </div>
  );
}
